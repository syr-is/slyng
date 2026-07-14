import { browser } from '$app/environment';
import { setHost } from '@slyng/app-core/host';
import { setApi, setApiError } from '@slyng/app-core/api';
import { setRealtime, setRealtimeError } from '@slyng/app-core/realtime';
import { setBootStage } from '@slyng/app-core/boot-progress';
import { setSessionTokenProvider } from '@slyng/app-core/idp-fetch';
import { createSlyngRealtime, initSlyngClient, type SlyngClient } from '@slyng/client';

// Web app is served same-origin with the API behind a `/api` reverse proxy
// (Vite proxy in dev, nginx/Caddy in prod). Empty host = relative URLs.
setHost('');

// IdP surfaces (consent, delegations, profile/content authoring) read the
// session token from the same localStorage key the WASM client's
// LocalStorageStore persists to.
setSessionTokenProvider(() =>
	typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_KEY)
);

export const ssr = false;
export const prerender = false;

const SESSION_KEY = 'slyng_session';
let initPromise: Promise<SlyngClient> | null = null;

/**
 * Initialise the WASM client + realtime + finish any pending OAuth
 * bridge exchange.
 *
 * Memoised — every caller after the first gets the in-flight promise.
 *
 * Crucially, **this is not awaited inside `load()`**. SvelteKit's
 * `load` is a render barrier: awaiting WASM init here would leave the
 * user staring at the browser-default white background until the
 * ~1.4 MB `slyng_client_bg.wasm` has been fetched + compiled. Instead
 * we kick the init off so it overlaps with hydration, and the (app)
 * layout's bootstrap awaits `apiReady` + `realtimeReady` from
 * `@slyng/app-core` before issuing any `api.*` call. The visible
 * "Loading…" state inside the (app) layout now paints within a frame
 * of hydration instead of after a second of blocking init.
 *
 * Bridge exchange runs **before** `setApi(c)` so the very first thing
 * the rest of the app sees is an `api` that already holds the fresh
 * session — no race between auth check and the bridge handoff.
 */
async function ensureClient(url?: URL): Promise<SlyngClient> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		setBootStage('Loading runtime', 'fetching ~1.4 MB WebAssembly client');
		const c = await initSlyngClient(window.location.origin, { sessionKey: SESSION_KEY });
		setBootStage('Runtime ready');

		// Bridge handoff: when the OAuth callback redirects to `?slyng_bridge=…`,
		// swap it for a real session id (persisted under `localStorage` by the
		// Rust client's `LocalStorageStore`) BEFORE exposing the api singleton —
		// otherwise the (app) layout's checkAuth() can race the exchange and
		// redirect to /login mid-flight. Bridge tokens are namespaced and
		// single-use; scrub from history so the same code can't be replayed.
		const bridge = url?.searchParams.get('slyng_bridge');
		if (bridge) {
			setBootStage('Completing sign-in', 'exchanging bridge token');
			try {
				await c.auth.exchange(bridge);
			} catch (err) {
				// Expired / already consumed — fall through; (app) will redirect
				// to /login if no session is found.
				if (import.meta.env.DEV) {
					console.warn('[slyng] bridge exchange failed', err);
				}
			}
			if (url && typeof history !== 'undefined') {
				const cleaned = new URL(url.toString());
				cleaned.searchParams.delete('slyng_bridge');
				history.replaceState(history.state, '', cleaned.toString());
			}
		}

		setApi(c);

		setBootStage('Opening realtime channel');
		const realtime = await createSlyngRealtime(window.location.origin, {
			sessionKey: SESSION_KEY
		});
		setRealtime(realtime);

		return c;
	})().catch((err) => {
		setBootStage('Startup failed', err instanceof Error ? err.message : 'unknown error');
		console.error('[slyng] failed to initialise WASM client', err);
		// Route the failure through the readiness gates so any consumer
		// `await apiReady` / `await realtimeReady` falls out of its await
		// with a rejection — otherwise the (app) bootstrap hangs on
		// "Loading…" indefinitely with nothing to recover from.
		setApiError(err);
		setRealtimeError(err);
		// Don't pin a failed promise — allow a retry on next navigation.
		initPromise = null;
		throw err;
	});
	return initPromise;
}

export const load = ({ url }: { url: URL }) => {
	if (!browser) return {};
	// Fire-and-forget. `ensureClient`'s inner catch already logs the failure
	// and routes it through `setApiError`/`setRealtimeError`; the trailing
	// `.catch(() => {})` here just suppresses the unhandled-rejection that
	// would otherwise log when the (app) bootstrap is the actual consumer.
	void ensureClient(url).catch(() => {});
	return {};
};
