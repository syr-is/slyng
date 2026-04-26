import { browser } from '$app/environment';
import { setHost, setApiTransport, type ApiTransport } from '@syren/app-core/host';
import { setWsTokenProvider } from '@syren/app-core/stores/ws.svelte';
import { initSyrenClient, type SyrenClient } from '@syren/client';

// Web app is served same-origin with the API behind a `/api` reverse proxy
// (Vite proxy in dev, nginx/Caddy in prod). Empty host = relative URLs.
setHost('');

export const ssr = false;
export const prerender = false;

const SESSION_KEY = 'syren_session';
let client: SyrenClient | null = null;

/**
 * Initialise the WASM client + register it as the API / WS transport
 * once. The first `load()` call instantiates the wasm module
 * (~hundreds of kB; fetched once and cached) and wires
 * `setApiTransport` so every `@syren/app-core/api` request flows
 * through the same Rust transport native already uses — bearer auth
 * from `localStorage[syren_session]`, error parsing, retries.
 */
async function ensureClient(): Promise<SyrenClient> {
	if (client) return client;
	const c = await initSyrenClient(window.location.origin, { sessionKey: SESSION_KEY });
	const transport: ApiTransport = async (path, options) => {
		const method = options.method ?? 'GET';
		const result = await c.requestRaw(method, path, options.body as never);
		// `client.requestRaw` doesn't go through the typed `Client::logout`
		// path, so the LocalStorageStore wouldn't otherwise get cleared
		// after a logout. Wipe it here so the next page load is unauth.
		if (
			method.toUpperCase() === 'POST' &&
			path === '/auth/logout' &&
			typeof localStorage !== 'undefined'
		) {
			localStorage.removeItem(SESSION_KEY);
		}
		return result as never;
	};
	setApiTransport(transport);
	setWsTokenProvider(async () =>
		typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null
	);
	client = c;
	return c;
}

/**
 * If the page URL carries a `code=…` param, we just landed here from
 * the OAuth callback. Trade the bridge for a session id via
 * `client.loginComplete`, which exchanges + stamps
 * `localStorage[syren_session]` through the Rust client's
 * `LocalStorageStore`. Then scrub the param from the URL so the
 * single-use code doesn't sit in history / referrer headers.
 */
export const load = async ({ url }) => {
	if (!browser) return {};
	const c = await ensureClient();
	const code = url.searchParams.get('code');
	if (code) {
		try {
			await c.loginComplete(code);
		} catch {
			// Bridge code expired or already consumed — fall through; the
			// (app) bootstrap will redirect to /login if there's no session.
		}
		const cleaned = new URL(url.toString());
		cleaned.searchParams.delete('code');
		if (typeof history !== 'undefined') {
			history.replaceState(history.state, '', cleaned.toString());
		}
	}
	return {};
};
