/**
 * Account-scoped trusted domains for external link confirmation.
 * Loaded from server on auth, synced back on change.
 */

import { SvelteSet } from 'svelte/reactivity';
import { api } from '../api';

let domains = new SvelteSet<string>();
let loaded = false;

export function isTrusted(host: string): boolean {
	return domains.has(host);
}

export function getTrustedDomainsList() {
	return {
		get list() {
			return [...domains].sort();
		}
	};
}

export async function loadTrustedDomains() {
	if (loaded) return;
	try {
		const data = await api.users.me() as { trusted_domains?: string[] };
		if (Array.isArray(data?.trusted_domains)) {
			domains.clear();
			for (const d of data.trusted_domains) domains.add(d);
		}
		loaded = true;
	} catch {
		// Non-critical — dialog will just show for all links
	}
}

export async function addTrustedDomain(host: string) {
	domains.add(host);
	try {
		await api.users.updateMe({ trusted_domains: [...domains] });
	} catch {
		// Optimistic — already added locally
	}
}

export async function removeTrustedDomain(host: string) {
	domains.delete(host);
	try {
		await api.users.updateMe({ trusted_domains: [...domains] });
	} catch {
		// Optimistic — already removed locally
	}
}

export function clearTrustedDomains() {
	domains.clear();
	loaded = false;
}
