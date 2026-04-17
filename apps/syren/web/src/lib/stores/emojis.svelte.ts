/**
 * Custom emoji resolver — fetches per-user emoji sets from their syr instance.
 *
 * Each DID's emoji list is cached in a SvelteMap so any component calling
 * `resolveEmojis(did, instance_url)` inside a `$derived` re-renders when the
 * fetch lands. The PROFILE_UPDATE WS event invalidates a specific user's set
 * so additions/removals on the syr side propagate to syren clients.
 */

import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { resolveManifest } from './profiles.svelte';
import { proxied } from '$lib/utils/proxy';

export interface EmojiEntry {
	shortcode: string;
	url: string;
	is_sticker: boolean;
}

export interface EmojiBundle {
	did: string;
	instance_url: string;
	entries: EmojiEntry[];
	/** Shortcode → entry map; used by the renderer for O(1) lookups. */
	map: Map<string, EmojiEntry>;
	loading: boolean;
	error?: boolean;
}

const EMPTY_BUNDLE: Omit<EmojiBundle, 'did' | 'instance_url'> = {
	entries: [],
	map: new Map(),
	loading: false
};

const cache = new SvelteMap<string, EmojiBundle>();
const inflight = new Map<string, Promise<void>>();

async function fetchAndCache(did: string, instanceUrl: string) {
	try {
		const manifest = await resolveManifest(did, instanceUrl);
		const base = manifest.endpoints.public_emojis;
		if (!base) throw new Error('Instance has no public_emojis endpoint');

		const collected: EmojiEntry[] = [];
		const LIMIT = 200;
		const MAX_TOTAL = 500;
		let offset = 0;

		// Paginate until has_more=false or cap reached
		while (collected.length < MAX_TOTAL) {
			const url = `${base}${base.includes('?') ? '&' : '?'}limit=${LIMIT}&offset=${offset}`;
			const res = await fetch(proxied(url));
			if (!res.ok) throw new Error('emoji fetch failed');
			const body = (await res.json()) as {
				data: { shortcode: string; url: string; is_sticker: boolean }[];
				pagination?: { has_more?: boolean };
			};
			for (const e of body.data ?? []) {
				collected.push({ shortcode: e.shortcode, url: e.url, is_sticker: !!e.is_sticker });
			}
			if (!body.pagination?.has_more) break;
			offset += LIMIT;
		}

		const map = new Map<string, EmojiEntry>();
		for (const e of collected) map.set(e.shortcode, e);

		cache.set(did, {
			did,
			instance_url: instanceUrl,
			entries: collected,
			map,
			loading: false
		});
	} catch {
		cache.set(did, {
			did,
			instance_url: instanceUrl,
			...EMPTY_BUNDLE,
			loading: false,
			error: true
		});
	} finally {
		inflight.delete(did);
	}
}

/**
 * Returns the cached emoji bundle for a DID. Triggers a background fetch if
 * not cached. Safe inside `$derived` — mutations happen in async microtasks.
 */
export function resolveEmojis(did: string, instanceUrl?: string): EmojiBundle {
	const cached = cache.get(did);
	if (cached) return cached;

	if (instanceUrl && !inflight.has(did)) {
		inflight.set(did, fetchAndCache(did, instanceUrl));
	}

	return {
		did,
		instance_url: instanceUrl ?? '',
		...EMPTY_BUNDLE,
		loading: !!instanceUrl
	};
}

export function invalidateEmojis(did: string) {
	cache.delete(did);
	inflight.delete(did);
}

// The profile watcher's PROFILE_UPDATE event already fires on emoji changes
// too (the syr hash endpoint includes story/profile hashes — extending it to
// include emoji hashes would be another diff). For now, invalidate on
// profile update as a reasonable approximation.
onWsEvent(WsOp.PROFILE_UPDATE, (raw) => {
	const d = raw as { did?: string };
	if (d?.did) invalidateEmojis(d.did);
});
