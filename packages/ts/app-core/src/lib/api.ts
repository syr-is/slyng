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
 * Wire the singleton API client. Call this from the host's root layout
 * once the WASM module is loaded. Both apps' `+layout.ts` does this in
 * their `load()` so children render with `api.*` already wired.
 */
export function setApi(client: SyrenClient): void {
	_client = client;
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
