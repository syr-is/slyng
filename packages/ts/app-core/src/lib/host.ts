/**
 * Runtime API host configuration.
 *
 * Each frontend app calls `setHost()` exactly once at boot, before any code
 * issues a request through the api/ws clients. The web app sets `''`
 * (same-origin, relies on dev proxy / reverse proxy). The Tauri native app
 * sets the user-configured absolute URL persisted in Tauri's store plugin.
 */

let _baseUrl = '';
let _bearer: string | null = null;

export function setHost(url: string): void {
	_baseUrl = (url ?? '').replace(/\/$/, '');
}

export function getHost(): string {
	return _baseUrl;
}

/**
 * Native (Tauri) sets this once on boot from `tauri-plugin-store`,
 * and again whenever the Rust side completes an OAuth round-trip.
 * The web app leaves it null and continues to rely on cookies.
 *
 * `null` clears the bearer (e.g. on sign-out).
 */
export function setBearerToken(token: string | null): void {
	_bearer = token && token.length > 0 ? token : null;
}

export function getBearerToken(): string | null {
	return _bearer;
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
