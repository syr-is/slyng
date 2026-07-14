/**
 * `idpFetch` — the single authed-fetch chokepoint for syren's local
 * identity-provider surface (consent, delegations, profile editing,
 * stories/posts/emoji/library authoring).
 *
 * Why not the WASM client: the IdP endpoints are syr-protocol REST — the
 * exact shapes a dedicated syr instance serves and syr's own frontend
 * consumes with plain fetch. Mirroring every IdP route through the Rust
 * client (plus a Tauri command each for native) would triple the surface
 * for endpoints whose contract is owned by the syr protocol, not by
 * syren's Rust types. Instead the host registers a session-token
 * provider at boot (web: the WASM client's localStorage key; native: the
 * Tauri `session_token` command) and every IdP call flows through here
 * with `credentials: 'include'` + `Authorization: Bearer`.
 */

import { apiUrl } from './host.js';

let _tokenProvider: (() => Promise<string | null> | string | null) | null = null;

/** Host apps register how to read the active session token at boot. */
export function setSessionTokenProvider(
	provider: () => Promise<string | null> | string | null
): void {
	_tokenProvider = provider;
}

async function sessionToken(): Promise<string | null> {
	if (!_tokenProvider) return null;
	try {
		return await _tokenProvider();
	} catch {
		return null;
	}
}

/**
 * Fetch an API path with session auth (cookie + Bearer when available).
 * `path` is relative to the API base (e.g. `/platform/delegations`).
 */
export async function idpFetch(path: string, init?: RequestInit): Promise<Response> {
	const token = await sessionToken();
	const headers = new Headers(init?.headers);
	if (token && !headers.has('Authorization')) {
		headers.set('Authorization', `Bearer ${token}`);
	}
	if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	return fetch(apiUrl(path), {
		credentials: 'include',
		...init,
		headers
	});
}

/** `idpFetch` + JSON parse + uniform error surface. */
export async function idpJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await idpFetch(path, init);
	const body = (await res.json().catch(() => null)) as
		| (T & { message?: string; error_description?: string })
		| null;
	if (!res.ok) {
		const msg = body?.message ?? body?.error_description ?? `Request failed (${res.status})`;
		throw new Error(msg);
	}
	if (body === null) throw new Error('Malformed response');
	return body;
}
