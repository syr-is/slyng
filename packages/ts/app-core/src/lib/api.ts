/**
 * `api` — the single typed API client surface, shared by every page in
 * web and native. The actual HTTP / bearer-auth / error-parsing logic
 * lives in the Rust `syren-client` crate; both apps consume it through
 * the WASM-backed `@syren/client` adapter and register it here at boot
 * via `setApi(client)`.
 *
 * Every endpoint's URL, body shape, and response shape is defined in
 * Rust, exactly once. There is no per-app fetch wrapper, no per-method
 * Tauri command, no `request()` chokepoint — the URL knowledge lives
 * with the transport that uses it.
 */

import type { SyrenClient } from '@syren/client';

let _client: SyrenClient | null = null;

/**
 * Resolves the moment `setApi(...)` is first called, or rejects if the
 * host signals an init failure via `setApiError(...)`.
 *
 * App layouts await this before issuing any `api.*` call so the host's
 * boot chain can stay non-blocking: web's `+layout.ts` kicks off WASM
 * init without awaiting (so SvelteKit can render chrome immediately),
 * the WASM finishes loading on its own, then `setApi(...)` flips this
 * promise and the layout's bootstrap proceeds. If the WASM fetch /
 * compile errors out, the host calls `setApiError(...)` so the promise
 * rejects — without this, the bootstrap's `await apiReady` would hang
 * forever and the user would be stuck on "Loading…" with no recovery.
 *
 * Native's `+layout.ts` calls `setApi` synchronously during its own
 * `load()` so this resolves before any (app)-route renders — no
 * behavioural change for the native shell.
 */
let _apiResolve: (() => void) | undefined;
let _apiReject: ((err: unknown) => void) | undefined;
export const apiReady: Promise<void> = new Promise<void>((resolve, reject) => {
	_apiResolve = resolve;
	_apiReject = reject;
});

function clearGate() {
	_apiResolve = undefined;
	_apiReject = undefined;
}

/**
 * Wire the singleton API client. Call this from the host's root layout
 * once the WASM module is loaded. Both apps' `+layout.ts` does this in
 * their `load()` so children render with `api.*` already wired.
 */
export function setApi(client: SyrenClient): void {
	_client = client;
	if (_apiResolve) {
		_apiResolve();
		clearGate();
	}
}

/**
 * Surface a host-side init failure to consumers awaiting `apiReady`
 * (typically a WASM fetch error on flaky / offline networks). Rejects
 * the gate so app layouts can show a recoverable error state instead
 * of hanging on a never-resolving promise. No-op once the gate has
 * already settled.
 */
export function setApiError(err: unknown): void {
	if (_apiReject) {
		_apiReject(err);
		clearGate();
	}
}

function get(): SyrenClient {
	if (!_client) {
		throw new Error(
			"@syren/app-core/api: client not initialised — call setApi(initSyrenClient(...)) in your root layout's load()"
		);
	}
	return _client;
}

/**
 * Singleton facade. Each top-level namespace is a getter that pulls the
 * registered client lazily, so consumers can `import { api }` at module
 * top level without caring about init ordering — as long as `setApi` is
 * called before the first `api.foo.bar()` invocation, all good.
 */
export const api: SyrenClient = {
	get auth() {
		return get().auth;
	},
	get servers() {
		return get().servers;
	},
	get invites() {
		return get().invites;
	},
	get roles() {
		return get().roles;
	},
	get channels() {
		return get().channels;
	},
	get uploads() {
		return get().uploads;
	},
	get users() {
		return get().users;
	},
	get relations() {
		return get().relations;
	},
	get voice() {
		return get().voice;
	},
	get categories() {
		return get().categories;
	},
	get overrides() {
		return get().overrides;
	}
} as SyrenClient;
