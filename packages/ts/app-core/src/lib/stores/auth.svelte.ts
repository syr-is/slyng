/**
 * Identity store. Holds DID + syr instance only — profile data is resolved
 * client-side from the user's instance via `profiles.svelte.ts`.
 */

import { apiUrl } from '../host';

const SESSION_KEY = 'syren_session';

export interface AuthIdentity {
	did: string;
	syr_instance_url: string;
	delegate_public_key?: string;
}

let identity = $state<AuthIdentity | null>(null);
let loading = $state(true);
let checked = false;

export function getAuth() {
	return {
		get identity() { return identity; },
		get user() { return identity; }, // back-compat alias
		get loading() { return loading; },
		get authenticated() { return identity !== null; }
	};
}

export async function checkAuth(): Promise<AuthIdentity | null> {
	if (import.meta.env.DEV) console.log('[checkAuth] entry checked=', checked, 'authed=', !!identity?.did);
	if (checked) {
		return identity;
	}

	loading = true;
	try {
		// Plain fetch with both cookie *and* Bearer attachment — covers
		// every shape we deploy:
		//  - web same-origin with cookie auth (legacy): credentials send
		//    the cookie.
		//  - web with Bearer in localStorage (post-bridge): Authorization
		//    header attaches it.
		//  - native (Tauri webview, cross-origin to API host): cookies
		//    don't cross, but the Bearer in localStorage (mirrored from
		//    the Tauri Store at boot) authenticates the call.
		// This deliberately bypasses the WASM api singleton — checkAuth
		// is sometimes called from page scripts that run before
		// +layout.ts's `setApi()` lands, and the lazy facade would throw.
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (typeof localStorage !== 'undefined') {
			const session = localStorage.getItem(SESSION_KEY);
			if (session) headers.Authorization = `Bearer ${session}`;
		}
		const url = apiUrl('/auth/me');
		console.log('[checkAuth] fetching', url, 'bearer=', !!headers.Authorization);
		// Hard 8s ceiling so a stalled fetch (DNS / TLS / mid-flight
		// socket hang) surfaces as a visible failure instead of an
		// indefinite Loading screen.
		const ac = new AbortController();
		const timeoutId = setTimeout(() => ac.abort(), 8000);
		try {
			const resp = await fetch(url, {
				method: 'GET',
				credentials: 'include',
				headers,
				signal: ac.signal
			});
			console.log('[checkAuth] /auth/me status=', resp.status);
			if (resp.ok) {
				const data = (await resp.json()) as Partial<AuthIdentity>;
				if (data?.did && data?.syr_instance_url) {
					identity = {
						did: data.did,
						syr_instance_url: data.syr_instance_url,
						delegate_public_key: data.delegate_public_key
					};
				}
			}
		} finally {
			clearTimeout(timeoutId);
		}
	} catch (err) {
		// API unreachable / 401 / aborted — leave identity null
		console.warn('[checkAuth] failed', err);
	}
	checked = true;
	loading = false;
	if (import.meta.env.DEV) console.log('[checkAuth] exit authed=', !!identity?.did);
	return identity;
}

export function clearAuth() {
	identity = null;
	checked = false;
}
