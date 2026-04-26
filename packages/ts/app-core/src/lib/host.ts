/**
 * Runtime API host configuration.
 *
 * Each frontend app calls `setHost()` exactly once at boot, before any code
 * issues a request through the api/ws clients. The web app sets `''`
 * (same-origin, relies on dev proxy / reverse proxy). The Tauri native app
 * sets the user-configured absolute URL persisted in Tauri's store plugin.
 */

let _baseUrl = '';

export function setHost(url: string): void {
	_baseUrl = (url ?? '').replace(/\/$/, '');
}

export function getHost(): string {
	return _baseUrl;
}

/**
 * Pluggable HTTP transport. The web app leaves this unset, so api.ts
 * falls through to its default `fetch` implementation (cookies,
 * same-origin). The Tauri native shell installs an implementation
 * that forwards every request through a single Rust command, so all
 * HTTP flows through `syren-client`'s reqwest with persistent cookies
 * and the session id stored in `tauri-plugin-store` — no auth state
 * ever leaks into JS.
 *
 * Called once from the platform's boot path. `null` clears it.
 */
export type ApiTransport = <T = unknown>(
	path: string,
	options: { method?: string; body?: unknown }
) => Promise<T>;

let _transport: ApiTransport | null = null;

export function setApiTransport(t: ApiTransport | null): void {
	_transport = t;
}

export function getApiTransport(): ApiTransport | null {
	return _transport;
}

/** Build an absolute API URL for `path` (which must start with `/`). */
export function apiUrl(path: string): string {
	return `${_baseUrl}/api${path}`;
}

/** Origin used by the WebSocket client; `/ws` is appended in the ws layer. */
export function wsOrigin(): string {
	if (_baseUrl) return _baseUrl.replace(/^http/, 'ws');
	if (typeof window !== 'undefined') {
		return window.location.origin.replace(/^http/, 'ws');
	}
	return '';
}

/** True when running same-origin (web app). False when explicit host (native). */
export function isSameOrigin(): boolean {
	return _baseUrl === '';
}
