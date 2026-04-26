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
	if (checked) return identity;

	loading = true;
	try {
		// Route through whatever transport is registered — Rust on
		// native, fetch on web. Same response shape either way.
		const transport = getApiTransport();
		const data = transport
			? await transport<Partial<AuthIdentity>>('/auth/me', { method: 'GET' })
			: await (await fetch(apiUrl('/auth/me'), { credentials: 'include' })).json();
		if (data?.did && data?.syr_instance_url) {
			identity = {
				did: data.did,
				syr_instance_url: data.syr_instance_url,
				delegate_public_key: data.delegate_public_key
			};
		}
	} catch {
		// API unreachable / 401
	}
	checked = true;
	loading = false;
	return identity;
}

export function clearAuth() {
	identity = null;
	checked = false;
}
