import { browser } from '$app/environment';
import { setHost, apiUrl } from '@syren/app-core/host';

// Web app is served same-origin with the API behind a `/api` reverse proxy
// (Vite proxy in dev, nginx/Caddy in prod). Empty host = relative URLs.
setHost('');

export const ssr = false;
export const prerender = false;

const SESSION_KEY = 'syren_session';

/**
 * If the page URL carries a `code=…` param, we just landed here from the
 * OAuth callback. The API stamps a one-shot bridge code onto every web
 * redirect alongside the cookie; trade it for the long-lived session id
 * and persist that under `localStorage[syren_session]` so every
 * subsequent request can ride a `Bearer …` header instead of the cookie.
 *
 * Awaiting this in `+layout.ts::load` blocks children from rendering
 * until the exchange settles, so the (app) layout's `checkAuth()` sees
 * the bearer already present in localStorage and the WS token provider
 * picks it up too.
 */
export const load = async ({ url }) => {
	if (!browser) return {};
	const code = url.searchParams.get('code');
	if (!code) return {};
	try {
		const res = await fetch(apiUrl('/auth/exchange'), {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code })
		});
		if (res.ok) {
			const data = (await res.json()) as { session?: string };
			if (data?.session) {
				localStorage.setItem(SESSION_KEY, data.session);
			}
		}
	} catch {
		// Bridge code expired or already consumed — fall through; the
		// (app) bootstrap will redirect to /login if the cookie path
		// also doesn't resolve.
	}
	// Scrub the bridge code from the URL — single-use, no point leaving
	// it in history / referrer headers.
	const cleaned = new URL(url.toString());
	cleaned.searchParams.delete('code');
	if (typeof history !== 'undefined') {
		history.replaceState(history.state, '', cleaned.toString());
	}
	return {};
};
