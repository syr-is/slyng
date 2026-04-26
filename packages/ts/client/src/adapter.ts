/**
 * Lazy-init wrapper that loads the WASM bundle exactly once and
 * re-exposes every method as a typed async function. Mirrors the
 * pattern used by `@syr-is/crypto`'s wasm-adapter.
 *
 * The web build (`./wasm`) requires calling the default export to
 * fetch + instantiate the .wasm file; the node build (used by Vite
 * SSR) is synchronous, so the default export there is `mod` itself.
 * We handle both by detecting whether `mod.default` is callable.
 */

export interface Identity {
	did: string;
	syr_instance_url: string;
	delegate_public_key?: string;
	trusted_domains?: string[];
	allow_dms?: 'open' | 'friends_only' | 'closed';
	allow_friend_requests?: 'open' | 'mutual' | 'closed';
}

export interface LoginResponse {
	consent_url: string;
}

export type Json = unknown;

interface WasmExports {
	default?: (() => Promise<unknown>) | unknown;
	Client: new (baseUrl: string, sessionKey?: string) => WasmClient;
}

interface WasmClient {
	request_raw(method: string, path: string, body?: Json): Promise<Json>;

	login_start(instance_url: string, redirect?: string): Promise<LoginResponse>;
	login_complete(code: string): Promise<Identity>;
	me(): Promise<Identity>;
	logout(): Promise<void>;

	servers_list(): Promise<Json[]>;
	server_get(id: string): Promise<Json>;
	server_channels(id: string): Promise<Json[]>;
	server_members(id: string): Promise<Json[]>;

	channel_messages(id: string, before?: string, limit?: number): Promise<Json[]>;
	channel_send(id: string, body: Json): Promise<Json>;
	channel_typing(id: string): Promise<Json>;

	users_me(): Promise<Json>;
	dm_channels(): Promise<Json[]>;

	roles_list(server_id: string): Promise<Json[]>;
	my_permissions(server_id: string): Promise<Json>;

	categories_list(server_id: string): Promise<Json[]>;
	relations_snapshot(): Promise<Json>;

	invite_preview(code: string): Promise<Json>;
	invite_join(code: string): Promise<Json>;
}

let wasm: WasmExports | null = null;
let initPromise: Promise<void> | null = null;

async function loadWasm(): Promise<WasmExports> {
	if (wasm) return wasm;
	if (!initPromise) {
		initPromise = (async () => {
			if (typeof globalThis.WebAssembly === 'undefined') {
				throw new Error('WebAssembly is not supported in this environment');
			}
			// `@syren/client/wasm` resolves to the browser bundle in a
			// browser-targeted build (Vite, esbuild) and to the
			// nodejs-target bundle under Node thanks to the
			// `package.json` `exports` conditions. We use a plain
			// dynamic import so the host bundler can statically
			// discover the dependency and emit the matching `.wasm`
			// asset alongside the JS — this is the difference between
			// "works in dev / Node" and "works in a Vite build".
			const mod = (await import('@syren/client/wasm')) as unknown as WasmExports;
			if (typeof mod.default === 'function') {
				await (mod.default as () => Promise<unknown>)();
			}
			wasm = mod;
		})();
	}
	await initPromise;
	if (!wasm) throw new Error('@syren/client: WASM failed to initialise');
	return wasm;
}

/**
 * Creates and returns a typed handle. The first call lazily fetches
 * and instantiates the WASM module; subsequent calls reuse it.
 *
 * @param baseUrl  API host root (e.g. `https://app.slyng.gg`).
 * @param opts.sessionKey  localStorage key under which the bearer
 *   token is persisted. Defaults to `syren_session`.
 */
export async function initSyrenClient(
	baseUrl: string,
	opts: { sessionKey?: string } = {}
): Promise<SyrenClient> {
	const m = await loadWasm();
	const inner = new m.Client(baseUrl, opts.sessionKey ?? 'syren_session');
	return wrap(inner);
}

export interface SyrenClient {
	/**
	 * Generic transport — sends an arbitrary HTTP request through the
	 * underlying Rust client (bearer-auth, cookie jar, error parsing).
	 * Used by `@syren/app-core/host::setApiTransport` so every method
	 * on api.ts routes through here.
	 *
	 * @param method  HTTP verb. `'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'`.
	 * @param path  API path *after* the `/api` prefix, e.g. `/auth/me`.
	 * @param body  JSON-serialisable body for POST/PATCH/PUT, or `undefined`.
	 */
	requestRaw<T = Json>(method: string, path: string, body?: Json): Promise<T>;

	loginStart(instanceUrl: string, redirect?: string): Promise<LoginResponse>;
	loginComplete(code: string): Promise<Identity>;
	me(): Promise<Identity>;
	logout(): Promise<void>;

	servers: {
		list(): Promise<Json[]>;
		get(id: string): Promise<Json>;
		channels(id: string): Promise<Json[]>;
		members(id: string): Promise<Json[]>;
	};

	channels: {
		messages(id: string, before?: string, limit?: number): Promise<Json[]>;
		send(id: string, body: Json): Promise<Json>;
		typing(id: string): Promise<Json>;
	};

	users: {
		me(): Promise<Json>;
		dmChannels(): Promise<Json[]>;
	};

	roles: {
		list(serverId: string): Promise<Json[]>;
		myPermissions(serverId: string): Promise<Json>;
	};

	categories: {
		list(serverId: string): Promise<Json[]>;
	};

	relations: {
		snapshot(): Promise<Json>;
	};

	invites: {
		preview(code: string): Promise<Json>;
		join(code: string): Promise<Json>;
	};
}

function wrap(c: WasmClient): SyrenClient {
	return {
		requestRaw: <T = Json>(method: string, path: string, body?: Json) =>
			c.request_raw(method, path, body) as Promise<T>,

		loginStart: (i, r) => c.login_start(i, r),
		loginComplete: (code) => c.login_complete(code),
		me: () => c.me(),
		logout: () => c.logout(),

		servers: {
			list: () => c.servers_list(),
			get: (id) => c.server_get(id),
			channels: (id) => c.server_channels(id),
			members: (id) => c.server_members(id)
		},

		channels: {
			messages: (id, before, limit) => c.channel_messages(id, before, limit),
			send: (id, body) => c.channel_send(id, body),
			typing: (id) => c.channel_typing(id)
		},

		users: {
			me: () => c.users_me(),
			dmChannels: () => c.dm_channels()
		},

		roles: {
			list: (id) => c.roles_list(id),
			myPermissions: (id) => c.my_permissions(id)
		},

		categories: {
			list: (id) => c.categories_list(id)
		},

		relations: {
			snapshot: () => c.relations_snapshot()
		},

		invites: {
			preview: (code) => c.invite_preview(code),
			join: (code) => c.invite_join(code)
		}
	};
}
