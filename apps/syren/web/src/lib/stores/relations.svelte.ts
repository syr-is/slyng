/**
 * Per-user relations — friends, incoming/outgoing friend requests, blocklist,
 * ignorelist, and the actor's own allow_dms / allow_friend_requests policies.
 * Loaded once on bootstrap, kept live via the WS opcodes in the 53–58 range.
 *
 * Reactive containers come from `svelte/reactivity` because `$state(new Set())`
 * isn't deep-reactive for `.add` / `.delete` — per CLAUDE.md rule 11.
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { getAuth } from './auth.svelte';
import { api } from '$lib/api';

type AllowDms = 'open' | 'friends_only' | 'closed';
type AllowFriendRequests = 'open' | 'mutual' | 'closed';

const friends = new SvelteSet<string>();
const blocked = new SvelteSet<string>();
const ignored = new SvelteSet<string>();
const incoming = new SvelteMap<string, { created_at: string }>();
const outgoing = new SvelteMap<string, { created_at: string }>();
// did → syr_instance_url for any DID we've seen through the relations
// surface. Populated from the bootstrap snapshot and from add-side WS
// events (FRIEND_REQUEST_RECEIVE / FRIEND_REQUEST_UPDATE pending /
// BLOCK_UPDATE blocked=true / IGNORE_UPDATE ignored=true). `resolveProfile`
// needs an instance URL to kick off the federated fetch — without it,
// the list pages render raw truncated DIDs.
const instances = new SvelteMap<string, string>();
let allowDms = $state<AllowDms>('open');
let allowFriendRequests = $state<AllowFriendRequests>('open');
let loaded = $state(false);

function rememberInstance(did: string, url: string | null | undefined) {
	if (!did || !url) return;
	instances.set(did, url);
}

export function getRelations() {
	return {
		get friends() { return friends; },
		get blocked() { return blocked; },
		get ignored() { return ignored; },
		get incoming() { return incoming; },
		get outgoing() { return outgoing; },
		get allowDms() { return allowDms; },
		get allowFriendRequests() { return allowFriendRequests; },
		get loaded() { return loaded; },
		isFriend(did: string): boolean {
			return friends.has(did);
		},
		isBlocked(did: string): boolean {
			return blocked.has(did);
		},
		isIgnored(did: string): boolean {
			return ignored.has(did);
		},
		hasIncomingFrom(did: string): boolean {
			return incoming.has(did);
		},
		hasOutgoingTo(did: string): boolean {
			return outgoing.has(did);
		},
		/** Look up the federated home instance for a DID we've seen. Returns
		 *  undefined for DIDs outside the relations surface (e.g. a stranger
		 *  who DM'd us without ever being friended/blocked/ignored — those
		 *  come with instance URLs attached to the DM row). */
		instanceFor(did: string): string | undefined {
			return instances.get(did);
		},
		/** Compact state label used by the profile card to pick which button set to render. */
		state(did: string): 'friend' | 'incoming_pending' | 'outgoing_pending' | 'blocked' | 'ignored' | 'friend_ignored' | 'none' {
			if (blocked.has(did)) return 'blocked';
			const isFriend = friends.has(did);
			const isIgnored = ignored.has(did);
			if (isFriend && isIgnored) return 'friend_ignored';
			if (isFriend) return 'friend';
			// Pending requests take priority over ignore — ignore doesn't
			// cancel or hide friend requests. The request stays actionable
			// by both parties regardless of ignore state.
			if (incoming.has(did)) return 'incoming_pending';
			if (outgoing.has(did)) return 'outgoing_pending';
			if (isIgnored) return 'ignored';
			return 'none';
		}
	};
}

export async function loadRelations(): Promise<void> {
	try {
		const snap = await api.relations.snapshot();
		friends.clear();
		for (const d of snap.friends) friends.add(d);
		blocked.clear();
		for (const d of snap.blocked) blocked.add(d);
		ignored.clear();
		for (const d of snap.ignored) ignored.add(d);
		incoming.clear();
		for (const r of snap.incoming) incoming.set(r.from, { created_at: r.created_at });
		outgoing.clear();
		for (const r of snap.outgoing) outgoing.set(r.to, { created_at: r.created_at });
		// Rebuild the instance map to match the snapshot — drop stale entries
		// for DIDs no longer in the relations surface.
		instances.clear();
		for (const [did, url] of Object.entries(snap.instances ?? {})) {
			rememberInstance(did, url);
		}
		allowDms = snap.allow_dms;
		allowFriendRequests = snap.allow_friend_requests;
		loaded = true;
	} catch {
		// Best-effort on bootstrap; UI surfaces the failure elsewhere.
	}
}

/** Record a DID → instance mapping from an external source (e.g. a DM channel
 *  with `other_user_instance_url`). Never overwrites; first-known wins until
 *  the next snapshot load. */
export function rememberRelationInstance(did: string, url: string | null | undefined) {
	rememberInstance(did, url);
}

export function clearRelations() {
	friends.clear();
	blocked.clear();
	ignored.clear();
	incoming.clear();
	outgoing.clear();
	instances.clear();
	allowDms = 'open';
	allowFriendRequests = 'open';
	loaded = false;
}

// ── WS listeners ──

onWsEvent(WsOp.FRIEND_REQUEST_RECEIVE, (data) => {
	const d = data as { from: string; created_at: string; instance_url?: string | null };
	if (!d?.from) return;
	rememberInstance(d.from, d.instance_url);
	incoming.set(d.from, { created_at: d.created_at });
});

onWsEvent(WsOp.FRIEND_REQUEST_UPDATE, (data) => {
	const auth = getAuth();
	const me = auth.identity?.did;
	if (!me) return;
	const d = data as {
		pair: { a: string; b: string };
		status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'removed';
		by: string;
		created_at?: string;
		instance_url?: string | null;
	};
	if (!d?.pair) return;
	const other = d.pair.a === me ? d.pair.b : d.pair.a;
	rememberInstance(other, d.instance_url);
	if (d.status === 'pending') {
		// First-party echo for the sender (cross-tab); the recipient already
		// got FRIEND_REQUEST_RECEIVE. Populate outgoing or incoming based on
		// which side `by` is so we stay correct in both directions.
		const createdAt = d.created_at ?? new Date().toISOString();
		if (d.by === me) outgoing.set(other, { created_at: createdAt });
		else incoming.set(other, { created_at: createdAt });
	} else if (d.status === 'accepted') {
		friends.add(other);
		incoming.delete(other);
		outgoing.delete(other);
	} else {
		// declined / cancelled / removed → clear from all friend buckets.
		friends.delete(other);
		incoming.delete(other);
		outgoing.delete(other);
	}
});

onWsEvent(WsOp.BLOCK_UPDATE, (data) => {
	const d = data as { target: string; blocked: boolean; instance_url?: string | null };
	if (!d?.target) return;
	if (d.blocked) {
		rememberInstance(d.target, d.instance_url);
		blocked.add(d.target);
		// Block is exclusive of friend + ignore (backend already stripped them,
		// echo the local state so the UI doesn't show stale badges).
		friends.delete(d.target);
		ignored.delete(d.target);
		incoming.delete(d.target);
		outgoing.delete(d.target);
	} else {
		blocked.delete(d.target);
	}
});

onWsEvent(WsOp.IGNORE_UPDATE, (data) => {
	const d = data as { target: string; ignored: boolean; instance_url?: string | null };
	if (!d?.target) return;
	if (d.ignored) {
		rememberInstance(d.target, d.instance_url);
		ignored.add(d.target);
	} else {
		ignored.delete(d.target);
	}
});

onWsEvent(WsOp.DM_POLICY_UPDATE, (data) => {
	const d = data as {
		allow_dms?: AllowDms;
		allow_friend_requests?: AllowFriendRequests;
	};
	if (d.allow_dms) allowDms = d.allow_dms;
	if (d.allow_friend_requests) allowFriendRequests = d.allow_friend_requests;
});
