/**
 * Identity store. Holds DID + syr instance only — profile data is resolved
 * client-side from the user's instance via `profiles.svelte.ts`.
 */

import { apiUrl } from '../host';

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
		const res = await fetch(apiUrl('/auth/me'), { credentials: 'include' });
		if (res.ok) {
			const data = (await res.json()) as Partial<AuthIdentity>;
			if (data?.did && data?.syr_instance_url) {
				identity = {
					did: data.did,
					syr_instance_url: data.syr_instance_url,
					delegate_public_key: data.delegate_public_key
				};
			}
		}
	} catch {
		// API unreachable
	}
	checked = true;
	loading = false;
	return identity;
}

export function clearAuth() {
	identity = null;
	checked = false;
}
