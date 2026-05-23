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
let initPromise: Promise<SyrenClient> | null = null;

/**
 * Initialise the WASM client + realtime + finish any pending OAuth
 * bridge exchange.
 *
 * Memoised — every caller after the first gets the in-flight promise.
 *
 * Crucially, **this is not awaited inside `load()`**. SvelteKit's
 * `load` is a render barrier: awaiting WASM init here would leave the
 * user staring at the browser-default white background until the
 * ~1.4 MB `syren_client_bg.wasm` has been fetched + compiled. Instead
 * we kick the init off so it overlaps with hydration, and the (app)
 * layout's bootstrap awaits `apiReady` + `realtimeReady` from
 * `@syren/app-core` before issuing any `api.*` call. The visible
 * "Loading…" state inside the (app) layout now paints within a frame
 * of hydration instead of after a second of blocking init.
 *
 * Bridge exchange runs **before** `setApi(c)` so the very first thing
 * the rest of the app sees is an `api` that already holds the fresh
 * session — no race between auth check and the bridge handoff.
 */
async function ensureClient(url?: URL): Promise<SyrenClient> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const c = await initSyrenClient(window.location.origin, { sessionKey: SESSION_KEY });

		// Bridge handoff: when the OAuth callback redirects to `?syren_bridge=…`,
		// swap it for a real session id (persisted under `localStorage` by the
		// Rust client's `LocalStorageStore`) BEFORE exposing the api singleton —
		// otherwise the (app) layout's checkAuth() can race the exchange and
		// redirect to /login mid-flight. Bridge tokens are namespaced and
		// single-use; scrub from history so the same code can't be replayed.
		const bridge = url?.searchParams.get('syren_bridge');
		if (bridge) {
			try {
				await c.auth.exchange(bridge);
			} catch (err) {
				// Expired / already consumed — fall through; (app) will redirect
				// to /login if no session is found.
				if (import.meta.env.DEV) {
					console.warn('[syren] bridge exchange failed', err);
				}
			}
			if (url && typeof history !== 'undefined') {
				const cleaned = new URL(url.toString());
				cleaned.searchParams.delete('syren_bridge');
				history.replaceState(history.state, '', cleaned.toString());
			}
		}

		setApi(c);

		const realtime = await createSyrenRealtime(window.location.origin, {
			sessionKey: SESSION_KEY
		});
		setRealtime(realtime);

		return c;
	})().catch((err) => {
		console.error('[syren] failed to initialise WASM client', err);
		// Don't pin a failed promise — allow a retry on next navigation.
		initPromise = null;
		throw err;
	});
	return initPromise;
}

export const load = ({ url }: { url: URL }) => {
	if (!browser) return {};
	// Fire-and-forget. The promise is memoised by `ensureClient`, so the
	// (app) layout will pick up the same in-flight init via `apiReady` /
	// `realtimeReady` without re-kicking. Errors surface through the
	// rejection inside ensureClient (logged) and through `api.*` calls
	// throwing for callers that didn't await `apiReady`.
	void ensureClient(url);
	return {};
};
