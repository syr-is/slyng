/**
 * Client helpers for P8 interactions — comments + reactions on posts/comments.
 *
 * Two transports, mirroring the split on the server:
 *   • Owner writes (create/edit/delete comment, toggle reaction) always go to
 *     the caller's OWN instance, same-origin + authed, via `idpJson`.
 *   • Public reads use the by-target aggregation endpoints on the CONTENT-HOST
 *     instance (every interaction hosted there for a post/comment), fetched
 *     through `proxied()` so a remote host never sees the viewer's IP.
 *
 * The per-author federation reads (`/api/public/{comments,reactions}/:did`)
 * exist server-side for cross-instance/export use; the UI renders threads from
 * the aggregation reads, which is the right model for a community instance.
 */

import { idpJson } from '../idp-fetch.js';
import { proxied } from '../utils/proxy.js';
import { resolveManifest } from '../stores/profiles.svelte.js';
import type {
	CommentCreate,
	CommentUpdate,
	OwnedComment,
	OwnedFollow,
	PublicComment,
	ReactionCreate,
	PublicReaction,
	ReactionToggleResponse,
	ReactionParentType
} from '@syren/types';

interface Envelope<T> {
	status: string;
	data: T;
}
interface Page<T> {
	data: T[];
	pagination: { limit: number; offset: number; total: number; has_more: boolean };
}

export type { OwnedComment, PublicComment, PublicReaction, ReactionParentType };

const base = (host: string) => host.replace(/\/+$/, '');

// ── Comments (owner writes) ──────────────────────────────────────────

export async function createComment(body: CommentCreate): Promise<OwnedComment> {
	const { data } = await idpJson<Envelope<OwnedComment>>('/comments', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	return data;
}

export async function updateComment(
	did: string,
	localId: string,
	patch: CommentUpdate
): Promise<OwnedComment> {
	const { data } = await idpJson<Envelope<OwnedComment>>(
		`/comments/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
		{ method: 'PATCH', body: JSON.stringify(patch) }
	);
	return data;
}

export async function deleteComment(did: string, localId: string): Promise<void> {
	await idpJson(`/comments/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`, {
		method: 'DELETE'
	});
}

// ── Reactions (owner writes) ─────────────────────────────────────────

/** Toggle a reaction — the server creates it, or removes it if you already had it. */
export async function toggleReaction(body: ReactionCreate): Promise<ReactionToggleResponse> {
	const res = await idpJson<{ status: string } & ReactionToggleResponse>('/reactions', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	return res.action === 'created'
		? { action: 'created', data: res.data }
		: { action: 'removed' };
}

// ── Public aggregation reads (content-host instance) ─────────────────

/** Every comment hosted on `hostBase` for a post — the thread. Oldest first. */
export async function fetchThreadComments(
	hostBase: string,
	postDid: string,
	postId: string,
	opts: { limit?: number; offset?: number } = {}
): Promise<Page<PublicComment>> {
	const qs = new URLSearchParams();
	if (opts.limit != null) qs.set('limit', String(opts.limit));
	if (opts.offset != null) qs.set('offset', String(opts.offset));
	const suffix = qs.toString() ? `?${qs}` : '';
	const url = `${base(hostBase)}/api/public/threads/comments/${encodeURIComponent(postDid)}/${encodeURIComponent(postId)}${suffix}`;
	return readPage<PublicComment>(url);
}

/** Every reaction hosted on `hostBase` for a target (post or comment). */
export async function fetchThreadReactions(
	hostBase: string,
	parentType: ReactionParentType,
	parentDid: string,
	parentId: string
): Promise<PublicReaction[]> {
	const url = `${base(hostBase)}/api/public/threads/reactions/${parentType}/${encodeURIComponent(parentDid)}/${encodeURIComponent(parentId)}`;
	return (await readPage<PublicReaction>(url)).data;
}

async function readPage<T>(url: string): Promise<Page<T>> {
	const res = await fetch(proxied(url), { headers: { Accept: 'application/json' } });
	if (!res.ok) throw new Error(`Interaction fetch failed (${res.status})`);
	const body = (await res.json()) as Page<T>;
	return {
		data: body.data ?? [],
		pagination: body.pagination ?? { limit: 0, offset: 0, total: 0, has_more: false }
	};
}

// ── syr-compatible fan-out (consuming remote content) ───────────────
// Displaying a post's interactions is the union of two reads:
//   1. by-target aggregation on the CONTENT-HOST instance — every interaction
//      hosted there (a syren enrichment; 404s harmlessly on a plain syr host).
//   2. per-author fan-out over `{viewer} ∪ {followed DIDs}`, each queried on its
//      OWN instance filtered to this post — this is syr's native model and the
//      only source when the host is a real syr instance (or the actor lives on
//      a different instance than the content).
// Merged + deduped by `did:local_id`. This makes syren a fully-compliant syr
// CONSUMER, not just a compliant emitter.

export interface FanoutTarget {
	did: string;
	base: string;
}

/** The DIDs to fan out over: the viewer plus everyone they follow (deduped). */
export function buildFanoutSet(
	viewer: { did?: string | null; base?: string | null } | null,
	following: Pick<OwnedFollow, 'followed_did' | 'followed_provider_url'>[]
): FanoutTarget[] {
	const set = new Map<string, FanoutTarget>();
	if (viewer?.did && viewer.base) set.set(viewer.did, { did: viewer.did, base: viewer.base });
	for (const f of following) {
		if (f.followed_provider_url && !set.has(f.followed_did)) {
			set.set(f.followed_did, { did: f.followed_did, base: f.followed_provider_url });
		}
	}
	return [...set.values()];
}

/** Resolve a fan-out DID's `public_comments`/`public_reactions` endpoint via its
 * manifest (syr-protocol discovery), falling back to the conventional path. */
async function resolveEndpoint(
	t: FanoutTarget,
	which: 'public_comments' | 'public_reactions'
): Promise<string> {
	const fallbackPath = which === 'public_comments' ? 'comments' : 'reactions';
	const fallback = `${base(t.base)}/api/public/${fallbackPath}/${encodeURIComponent(t.did)}`;
	try {
		const manifest = await resolveManifest(t.did, t.base);
		return (manifest.endpoints as Record<string, string>)[which] || fallback;
	} catch {
		return fallback;
	}
}

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(proxied(url), { headers: { Accept: 'application/json' } });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

/** All comments on a post: by-target(host) ∪ per-author fan-out, oldest first. */
export async function fetchComments(
	hostBase: string,
	postDid: string,
	postId: string,
	fanout: FanoutTarget[]
): Promise<PublicComment[]> {
	const seen = new Map<string, PublicComment>();
	const add = (list: PublicComment[]) => {
		for (const c of list) seen.set(`${c.did}:${c.local_id}`, c);
	};

	const [host, ...authored] = await Promise.all([
		hostBase
			? fetchThreadComments(hostBase, postDid, postId, { limit: 200 }).catch(() => null)
			: Promise.resolve(null),
		...fanout.map(async (t) => {
			const ep = await resolveEndpoint(t, 'public_comments');
			const q = `post_did=${encodeURIComponent(postDid)}&post_id=${encodeURIComponent(postId)}&limit=200`;
			return fetchJson<Page<PublicComment>>(`${ep}?${q}`);
		})
	]);
	if (host) add(host.data);
	for (const r of authored) if (r) add(r.data ?? []);

	return [...seen.values()].sort(
		(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
	);
}

/**
 * Reactions for a whole thread (post + its comments) in one pass. The host is
 * queried by-target per target; each fan-out DID is queried ONCE for all its
 * reactions and filtered to the target set — so fan-out cost is O(followed),
 * not O(followed × targets). Returns a map keyed by `type:did:id`.
 */
export async function fetchReactionsForThread(
	hostBase: string,
	targets: { type: ReactionParentType; did: string; id: string }[],
	fanout: FanoutTarget[]
): Promise<Map<string, PublicReaction[]>> {
	const tkey = (type: string, did: string, id: string) => `${type}:${did}:${id}`;
	const buckets = new Map<string, Map<string, PublicReaction>>();
	for (const t of targets) buckets.set(tkey(t.type, t.did, t.id), new Map());
	const add = (r: PublicReaction) => {
		const b = buckets.get(tkey(r.parent_type, r.parent_did, r.parent_id));
		if (b) b.set(`${r.did}:${r.local_id}`, r);
	};

	await Promise.all([
		// Host by-target — one call per target (skips silently on a non-syren host).
		...targets.map((t) =>
			hostBase
				? fetchThreadReactions(hostBase, t.type, t.did, t.id)
						.then((list) => list.forEach(add))
						.catch(() => {})
				: Promise.resolve()
		),
		// Fan-out — one call per DID for ALL their reactions, filtered to targets.
		...fanout.map(async (t) => {
			const ep = await resolveEndpoint(t, 'public_reactions');
			const body = await fetchJson<Page<PublicReaction>>(`${ep}?limit=500`);
			for (const r of body?.data ?? []) if (buckets.has(tkey(r.parent_type, r.parent_did, r.parent_id))) add(r);
		})
	]);

	const out = new Map<string, PublicReaction[]>();
	for (const [k, m] of buckets) out.set(k, [...m.values()]);
	return out;
}

/** Reload one target's reactions (by-target ∪ fan-out) after a toggle. */
export async function reloadTargetReactions(
	hostBase: string,
	type: ReactionParentType,
	did: string,
	id: string,
	fanout: FanoutTarget[]
): Promise<PublicReaction[]> {
	const seen = new Map<string, PublicReaction>();
	await Promise.all([
		hostBase
			? fetchThreadReactions(hostBase, type, did, id)
					.then((l) => l.forEach((r) => seen.set(`${r.did}:${r.local_id}`, r)))
					.catch(() => {})
			: Promise.resolve(),
		...fanout.map(async (t) => {
			const ep = await resolveEndpoint(t, 'public_reactions');
			const q = `parent_type=${type}&parent_did=${encodeURIComponent(did)}&parent_id=${encodeURIComponent(id)}&limit=200`;
			const body = await fetchJson<Page<PublicReaction>>(`${ep}?${q}`);
			for (const r of body?.data ?? []) seen.set(`${r.did}:${r.local_id}`, r);
		})
	]);
	return [...seen.values()];
}

// ── Reaction grouping (client-side, mirrors syr's reaction-bar) ──────

export interface ReactionGroup {
	key: string;
	kind: PublicReaction['kind'];
	value: string;
	image_url: string | null;
	count: number;
	reacted: boolean;
	reactors: string[];
}

/** Group flat reactions by kind:value, count them, and flag the viewer's own. */
export function groupReactions(
	reactions: PublicReaction[],
	myDid: string | undefined
): ReactionGroup[] {
	const groups = new Map<string, ReactionGroup>();
	for (const r of reactions) {
		const key = `${r.kind}:${r.value}`;
		let g = groups.get(key);
		if (!g) {
			g = {
				key,
				kind: r.kind,
				value: r.value,
				image_url: r.image_url ?? null,
				count: 0,
				reacted: false,
				reactors: []
			};
			groups.set(key, g);
		}
		g.count++;
		g.reactors.push(r.did);
		if (myDid && r.did === myDid) g.reacted = true;
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}
