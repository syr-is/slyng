/**
 * Per-user GIF resolver. Fetches from the user's syr instance via its
 * `public_gifs` manifest endpoint.
 */

import { SvelteMap } from 'svelte/reactivity';
import { resolveManifest } from './profiles.svelte';
import { proxied } from '../utils/proxy';

export interface GifEntry {
	did: string;
	local_id: string;
	url: string;
	thumbnail_url?: string | null;
	tags?: string[];
	size?: number;
	mime_type?: string;
}

export interface GifBundle {
	did: string;
	query: string;
	entries: GifEntry[];
	loading: boolean;
	error?: boolean;
}

const cache = new SvelteMap<string, GifBundle>();
const inflight = new Map<string, Promise<void>>();

function key(did: string, query: string) {
	return `${did}::${query}`;
}

async function fetchAndCache(did: string, instanceUrl: string, query: string) {
	const k = key(did, query);
	try {
		const manifest = await resolveManifest(did, instanceUrl);
		const base = manifest.endpoints.public_gifs;
		if (!base) throw new Error('Instance has no public_gifs endpoint');
		const sep = base.includes('?') ? '&' : '?';
		const url = `${base}${sep}limit=24${query ? `&search=${encodeURIComponent(query)}` : ''}`;

		const res = await fetch(proxied(url));
		if (!res.ok) throw new Error('gif fetch failed');
		const body = (await res.json()) as { data: GifEntry[] };
		cache.set(k, {
			did,
			query,
			entries: body.data ?? [],
			loading: false
		});
	} catch {
		cache.set(k, {
			did,
			query,
			entries: [],
			loading: false,
			error: true
		});
	} finally {
		inflight.delete(k);
	}
}

export function resolveGifs(did: string, instanceUrl?: string, query = ''): GifBundle {
	const k = key(did, query);
	const cached = cache.get(k);
	if (cached) return cached;

	if (instanceUrl && !inflight.has(k)) {
		inflight.set(k, fetchAndCache(did, instanceUrl, query));
	}

	return {
		did,
		query,
		entries: [],
		loading: !!instanceUrl
	};
}

export function invalidateGifs(did: string) {
	const prefix = `${did}::`;
	for (const k of [...cache.keys()]) {
		if (k.startsWith(prefix)) cache.delete(k);
	}
}
