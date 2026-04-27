import { browser } from '$app/environment';
import { setHost } from '@syren/app-core/host';
import { setApi } from '@syren/app-core/api';
import { setRealtime } from '@syren/app-core/realtime';
import { createSyrenRealtime, initSyrenClient, type SyrenClient } from '@syren/client';

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
	const realtime = await createSyrenRealtime(window.location.origin, { sessionKey: SESSION_KEY });
	setRealtime(realtime);
	client = c;
	return c;
}

/**
 * If the page URL carries a `syren_bridge=…` param, we just landed
 * here from the OAuth callback. `client.auth.exchange(bridge)` posts
 * to /auth/exchange and persists the returned session id under
 * `localStorage[syren_session]` through the Rust client's
 * `LocalStorageStore`. Then scrub the param so the single-use code
 * doesn't sit in history / referrer headers.
 *
 * The param is namespaced (`syren_bridge`, not `code`) so the
 * unconditional consume-and-scrub pass doesn't fight any future route
 * that legitimately uses `?code=…` for its own purposes.
 */
export const load = async ({ url }) => {
	if (!browser) return {};
	let c: SyrenClient;
	try {
		c = await ensureClient();
	} catch (err) {
		// Surface a real error here — a swallowed init failure means a
		// blank app with no API client, which is much harder to debug
		// than a SvelteKit error page.
		console.error('[syren] failed to initialise WASM client', err);
		throw err;
	}
	const bridge = url.searchParams.get('syren_bridge');
	if (bridge) {
		try {
			await c.auth.exchange(bridge);
		} catch (err) {
			// Bridge code expired or already consumed — fall through;
			// the (app) bootstrap will redirect to /login if no session.
			if (import.meta.env.DEV) {
				console.warn('[syren] bridge exchange failed', err);
			}
		}
		const cleaned = new URL(url.toString());
		cleaned.searchParams.delete('syren_bridge');
		if (typeof history !== 'undefined') {
			history.replaceState(history.state, '', cleaned.toString());
		}
	}
	return {};
};
