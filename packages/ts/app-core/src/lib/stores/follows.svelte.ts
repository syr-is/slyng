/**
 * Follow state (P8). A reactive per-DID cache of "am I following this identity"
 * plus the follow/unfollow/visibility mutations. Follows are authored on the
 * caller's own instance (same-origin, authed via `idpJson`); the followed
 * identity's home instance is passed as `provider` so the same DID can be
 * followed once per provider (syr's model). The public following list is read
 * through the federation endpoint by the pages that show a "Following" tab.
 */

import { SvelteMap } from 'svelte/reactivity';
import { idpJson } from '../idp-fetch.js';
import type { OwnedFollow, FollowCheckResponse } from '@slyng/types';

interface Envelope<T> {
	status: string;
	data: T;
}

/** following state per DID (undefined = not yet checked). */
const followState = new SvelteMap<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

export function getFollows() {
	return {
		/** Reactive: whether the viewer follows `did` (false until resolved). */
		isFollowing(did: string): boolean {
			return followState.get(did) ?? false;
		},
		/** Whether we've resolved follow state for this DID yet. */
		checked(did: string): boolean {
			return followState.has(did);
		}
	};
}

/** Resolve + cache follow state for a DID. Deduped across concurrent callers. */
export async function checkFollow(did: string, provider?: string): Promise<boolean> {
	if (followState.has(did)) return followState.get(did) as boolean;
	const existing = inflight.get(did);
	if (existing) return existing;
	const p = (async () => {
		try {
			const qs = new URLSearchParams({ did });
			if (provider) qs.set('provider', provider);
			const { data } = await idpJson<Envelope<FollowCheckResponse>>(
				`/follows/check?${qs.toString()}`
			);
			followState.set(did, data.following);
			return data.following;
		} catch {
			followState.set(did, false);
			return false;
		} finally {
			inflight.delete(did);
		}
	})();
	inflight.set(did, p);
	return p;
}

export async function follow(did: string, provider?: string): Promise<void> {
	await idpJson<Envelope<OwnedFollow>>('/follows', {
		method: 'POST',
		body: JSON.stringify({ followed_did: did, provider_url: provider })
	});
	followState.set(did, true);
	invalidateFollowGraph();
}

export async function unfollow(did: string, provider?: string): Promise<void> {
	const qs = new URLSearchParams({ followed_did: did });
	if (provider) qs.set('provider_url', provider);
	await idpJson(`/follows?${qs.toString()}`, { method: 'DELETE' });
	followState.set(did, false);
	invalidateFollowGraph();
}

/** The viewer's own following list (for a "Following" tab / management UI). */
export async function listFollowing(): Promise<OwnedFollow[]> {
	const { data } = await idpJson<Envelope<OwnedFollow[]>>('/follows');
	return data;
}

// ── Follow graph (fan-out cache) ─────────────────────────────────────
// Cached copy of the viewer's following list, used to fan out interaction
// reads over `{viewer} ∪ {followed}` (syr's consumer model). Loaded once and
// shared across every thread/reaction view; invalidated on follow/unfollow so
// a freshly-followed identity joins the fan-out.
let followGraph: OwnedFollow[] | null = null;
let followGraphInflight: Promise<OwnedFollow[]> | null = null;

/** Load (once) + return the viewer's follow graph. Empty when logged out. */
export async function ensureFollowGraph(): Promise<OwnedFollow[]> {
	if (followGraph) return followGraph;
	if (followGraphInflight) return followGraphInflight;
	followGraphInflight = (async () => {
		try {
			followGraph = await listFollowing();
		} catch {
			followGraph = [];
		} finally {
			followGraphInflight = null;
		}
		return followGraph ?? [];
	})();
	return followGraphInflight;
}

function invalidateFollowGraph(): void {
	followGraph = null;
}

export async function setFollowVisibility(
	did: string,
	isPublic: boolean,
	provider?: string
): Promise<void> {
	await idpJson('/follows/visibility', {
		method: 'PATCH',
		body: JSON.stringify({
			followed_did: did,
			followed_provider_url: provider ?? null,
			is_public: isPublic
		})
	});
}
