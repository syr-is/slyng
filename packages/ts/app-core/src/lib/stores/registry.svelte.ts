/**
 * Discovery-registry + outbox state (P9). The user announces "this identity is
 * hosted here" to external discovery registries via a root-signed hosting
 * record. Managing registries enqueues outbox jobs; `sync(password)` unlocks the
 * root seed server-side to sign + push them. A background poller redelivers
 * already-signed jobs, so the UI just reflects status. All calls are authed
 * (same-origin) via `idpJson`.
 */

import { idpJson } from '../idp-fetch.js';
import type {
	OwnedRegistry,
	OwnedOutboxJob,
	RegistrySyncResult
} from '@syren/types';

interface Envelope<T> {
	status: string;
	data: T;
}

let registries = $state<OwnedRegistry[]>([]);
let outbox = $state<OwnedOutboxJob[]>([]);
let loaded = $state(false);

export function getRegistryState() {
	return {
		get registries() {
			return registries;
		},
		get outbox() {
			return outbox;
		},
		get loaded() {
			return loaded;
		}
	};
}

export async function loadRegistries(): Promise<void> {
	const [r, o] = await Promise.all([
		idpJson<Envelope<OwnedRegistry[]>>('/identity/registries'),
		idpJson<Envelope<OwnedOutboxJob[]>>('/identity/outbox')
	]);
	registries = r.data;
	outbox = o.data;
	loaded = true;
}

export async function addRegistry(url: string): Promise<void> {
	await idpJson<Envelope<OwnedRegistry>>('/identity/registries', {
		method: 'POST',
		body: JSON.stringify({ registry_url: url })
	});
	await loadRegistries();
}

export async function removeRegistry(id: string): Promise<void> {
	await idpJson(`/identity/registries/${encodeURIComponent(id)}`, { method: 'DELETE' });
	await loadRegistries();
}

/** Sign (with the account password) + push all pending jobs. Returns the run
 * summary; also refreshes the cached registry + outbox state. */
export async function syncRegistries(password: string): Promise<RegistrySyncResult> {
	const { data } = await idpJson<Envelope<RegistrySyncResult>>('/identity/registries/sync', {
		method: 'POST',
		body: JSON.stringify({ password })
	});
	await loadRegistries();
	return data;
}

export async function retryOutboxJob(id: string): Promise<void> {
	await idpJson(`/identity/outbox/${encodeURIComponent(id)}/retry`, { method: 'POST' });
	await loadRegistries();
}

export async function cancelOutboxJob(id: string): Promise<void> {
	await idpJson(`/identity/outbox/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
	await loadRegistries();
}
