/**
 * Stories resolver — fetches a user's active (24h) stories from their syr
 * instance. Only loaded on demand (when a profile hover card opens) since
 * stories are expensive to enumerate for every member of a server.
 */

import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { resolveManifest } from './profiles.svelte';
import { proxied } from '$lib/utils/proxy';

export interface StorySlide {
	id: string;
	mime_type: string;
	url: string;
	published_at: string;
	width?: number | null;
	height?: number | null;
	duration_seconds?: number | null;
}

export interface StoryBundle {
	did: string;
	slides: StorySlide[];
	loading: boolean;
	error?: boolean;
}

const cache = new SvelteMap<string, StoryBundle>();
const inflight = new Map<string, Promise<void>>();

async function fetchAndCache(did: string, instanceUrl: string) {
	try {
		const manifest = await resolveManifest(did, instanceUrl);
		const res = await fetch(proxied(manifest.endpoints.stories));
		if (!res.ok) throw new Error('stories fetch failed');
		const body = (await res.json()) as { data: { slides: StorySlide[] } };
		cache.set(did, {
			did,
			slides: body.data.slides ?? [],
			loading: false
		});
	} catch {
		cache.set(did, { did, slides: [], loading: false, error: true });
	} finally {
		inflight.delete(did);
	}
}

/**
 * Returns the current cached stories bundle. Kicks off a fetch if not cached.
 * Safe inside `$derived`.
 */
export function resolveStories(did: string, instanceUrl?: string): StoryBundle {
	const cached = cache.get(did);
	if (cached) return cached;

	if (instanceUrl && !inflight.has(did)) {
		inflight.set(did, fetchAndCache(did, instanceUrl));
	}

	return { did, slides: [], loading: !!instanceUrl };
}

export function hasStories(did: string): boolean {
	return (cache.get(did)?.slides.length ?? 0) > 0;
}

export function invalidateStories(did: string) {
	cache.delete(did);
	inflight.delete(did);
}

// Backend tells us a user's profile/stories hash changed — blow the cache so
// the next render refetches a fresh 24h story bundle.
onWsEvent(WsOp.PROFILE_UPDATE, (raw) => {
	const d = raw as { did?: string };
	if (d?.did) invalidateStories(d.did);
});
