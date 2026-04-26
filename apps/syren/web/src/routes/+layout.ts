import { browser } from '$app/environment';
import { setHost } from '@syren/app-core/host';
import { setApi } from '@syren/app-core/api';
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
 * Initialise the WASM client + register it as the singleton api on
 * first `load()`. Both apps share `@syren/app-core/api`'s lazy
 * facade — once `setApi(client)` runs, every `api.foo.bar()` call
 * routes through the same Rust transport that defines the URL,
 * body shape, and bearer-auth handling. No per-app fetch wrapper.
 */
async function ensureClient(): Promise<SyrenClient> {
	if (client) return client;
	const c = await initSyrenClient(window.location.origin, { sessionKey: SESSION_KEY });
	setApi(c);
	setWsTokenProvider(async () =>
		typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null
	);
	client = c;
	return c;
}

/**
 * If the page URL carries a `code=…` param, we just landed here from
 * the OAuth callback. `client.auth.exchange(code)` posts to
 * /auth/exchange and persists the returned session id under
 * `localStorage[syren_session]` through the Rust client's
 * `LocalStorageStore`. Then scrub the param so the single-use code
 * doesn't sit in history / referrer headers.
 */
export const load = async ({ url }) => {
	if (!browser) return {};
	const c = await ensureClient();
	const code = url.searchParams.get('code');
	if (code) {
		try {
			await c.auth.exchange(code);
		} catch {
			// Bridge code expired or already consumed — fall through;
			// the (app) bootstrap will redirect to /login if no session.
		}
		const cleaned = new URL(url.toString());
		cleaned.searchParams.delete('code');
		if (typeof history !== 'undefined') {
			history.replaceState(history.state, '', cleaned.toString());
		}
	}
	return {};
};
