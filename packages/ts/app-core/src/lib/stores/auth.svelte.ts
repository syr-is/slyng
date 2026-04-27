/**
 * Identity store. Holds DID + syr instance only — profile data is resolved
 * client-side from the user's instance via `profiles.svelte.ts`.
 */

import { api } from '../api';

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
		// Goes through the api singleton, which the host wires up to
		// the WASM client at boot. That client carries the Bearer
		// token from its session store on every request — using a raw
		// `fetch(apiUrl(...))` here would skip the bearer entirely on
		// native (Tauri webview) and silently 401, even though the
		// session id is sitting in localStorage.
		const data = await api.auth.me();
		if (import.meta.env.DEV) console.log('[checkAuth] /auth/me ok=', !!(data?.did && data?.syr_instance_url));
		if (data?.did && data?.syr_instance_url) {
			identity = {
				did: data.did,
				syr_instance_url: data.syr_instance_url,
				delegate_public_key: data.delegate_public_key
			};
		}
	} catch (err) {
		// API unreachable / 401
		if (import.meta.env.DEV) console.log('[checkAuth] caught', err);
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
