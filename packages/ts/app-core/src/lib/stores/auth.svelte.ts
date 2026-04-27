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
		// Goes through the registered api singleton — WASM-backed
		// (`@syren/client`) on web, Tauri-IPC-backed (`createNativeApi`)
		// on native. Both impls source the bearer from their respective
		// session store (localStorage for web, Tauri Store for native);
		// `checkAuth` does not need to know which.
		const data = await api.auth.me();
		if (data?.did && data?.syr_instance_url) {
			identity = {
				did: data.did,
				syr_instance_url: data.syr_instance_url,
				delegate_public_key: data.delegate_public_key
			};
		}
	} catch (err) {
		// 401 / network failure / api not yet wired — leave identity null.
		// Caller decides what to do (typically redirect to /login).
		if (import.meta.env.DEV) console.warn('[checkAuth] failed', err);
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
