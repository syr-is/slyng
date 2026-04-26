/**
 * Identity store. Holds DID + syr instance only — profile data is resolved
 * client-side from the user's instance via `profiles.svelte.ts`.
 */

import { getApiTransport, apiUrl } from '../host';

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
	console.log('[checkAuth] entry; checked =', checked, 'identity =', identity);
	if (checked) {
		console.log('[checkAuth] returning cached identity =', identity);
		return identity;
	}

	loading = true;
	try {
		// Route through whatever transport is registered — Rust on
		// native, fetch on web. Same response shape either way.
		const transport = getApiTransport();
		console.log('[checkAuth] transport =', typeof transport);
		const data = transport
			? await transport<Partial<AuthIdentity>>('/auth/me', { method: 'GET' })
			: await (await fetch(apiUrl('/auth/me'), { credentials: 'include' })).json();
		console.log('[checkAuth] /auth/me data =', data);
		if (data?.did && data?.syr_instance_url) {
			identity = {
				did: data.did,
				syr_instance_url: data.syr_instance_url,
				delegate_public_key: data.delegate_public_key
			};
			console.log('[checkAuth] identity set');
		} else {
			console.log('[checkAuth] /auth/me payload missing did/syr_instance_url');
		}
	} catch (err) {
		// API unreachable / 401
		console.log('[checkAuth] caught =', err);
	}
	checked = true;
	loading = false;
	console.log('[checkAuth] exit; identity =', identity);
	return identity;
}

export function clearAuth() {
	identity = null;
	checked = false;
}
