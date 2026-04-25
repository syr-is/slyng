/**
 * Posts resolver — fetches a user's public posts from their syr instance.
 * Mirrors the stories store pattern: SvelteMap cache, manifest-based
 * endpoint resolution, PROFILE_UPDATE invalidation, lazy fetch on demand.
 */

import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { resolveManifest } from './profiles.svelte';
import { proxied } from '../utils/proxy';

export interface Post {
	did: string;
	local_id: string;
	type: 'text' | 'media';
	title: string | null;
	description: string | null;
	visibility: string;
	status: string;
	created_at: string;
	updated_at: string;
	media_urls?: string[];
	display_mode?: string;
	content_type?: string;
}

export interface PostBundle {
	did: string;
	posts: Post[];
	total: number;
	loading: boolean;
	error?: boolean;
}

interface PostsResponse {
	status: string;
	data: Post[];
	pagination: { limit: number; offset: number; total: number; has_more: boolean };
}

const cache = new SvelteMap<string, PostBundle>();
const inflight = new Map<string, Promise<void>>();
const instanceUrls = new Map<string, string>();

async function fetchAndCache(did: string, instanceUrl: string, limit = 30, offset = 0) {
	try {
		const manifest = await resolveManifest(did, instanceUrl);
		const url = `${manifest.endpoints.posts}?limit=${limit}&offset=${offset}`;
		const res = await fetch(proxied(url));
		if (!res.ok) throw new Error('posts fetch failed');
		const body = (await res.json()) as PostsResponse;
		cache.set(did, {
			did,
			posts: body.data ?? [],
			total: body.pagination?.total ?? 0,
			loading: false
		});
	} catch {
		cache.set(did, { did, posts: [], total: 0, loading: false, error: true });
	} finally {
		inflight.delete(did);
	}
}

export function resolvePosts(did: string, instanceUrl?: string): PostBundle {
	const cached = cache.get(did);
	if (cached) return cached;

	if (instanceUrl && !inflight.has(did)) {
		instanceUrls.set(did, instanceUrl);
		inflight.set(did, fetchAndCache(did, instanceUrl));
	}

	return { did, posts: [], total: 0, loading: !!instanceUrl };
}

export async function loadMorePosts(
	did: string,
	instanceUrl: string,
	offset: number
): Promise<Post[]> {
	try {
		const manifest = await resolveManifest(did, instanceUrl);
		const url = `${manifest.endpoints.posts}?limit=30&offset=${offset}`;
		const res = await fetch(proxied(url));
		if (!res.ok) throw new Error('posts fetch failed');
		const body = (await res.json()) as PostsResponse;
		const existing = cache.get(did);
		if (existing) {
			cache.set(did, {
				...existing,
				posts: [...existing.posts, ...body.data],
				total: body.pagination?.total ?? existing.total
			});
		}
		return body.data ?? [];
	} catch {
		return [];
	}
}

export function invalidatePosts(did: string) {
	cache.delete(did);
	inflight.delete(did);
	const url = instanceUrls.get(did);
	if (url) {
		inflight.set(did, fetchAndCache(did, url));
	}
}

onWsEvent(WsOp.PROFILE_UPDATE, (raw) => {
	const d = raw as { did?: string };
	if (d?.did) invalidatePosts(d.did);
});
