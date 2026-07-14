<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { Button } from '@slyng/ui/button';
	import { LoaderCircle, MessageSquare, Reply, Pencil, Trash2, EyeOff } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { getRelations } from '@slyng/app-core/stores/relations.svelte';
	import { ensureFollowGraph } from '@slyng/app-core/stores/follows.svelte';
	import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import {
		fetchComments,
		fetchReactionsForThread,
		reloadTargetReactions,
		toggleReaction,
		buildFanoutSet,
		createComment,
		updateComment,
		deleteComment,
		type PublicComment,
		type PublicReaction,
		type FanoutTarget
	} from '@slyng/app-core/upload/interactions';
	import type { ReactionCreate, ReactionParentType } from '@slyng/types';
	import ReactionBar from './reaction-bar.svelte';

	/**
	 * Full interaction area for a post (P8): the post's reaction bar plus its
	 * threaded comments (each with its own reactions). All interaction data is
	 * the UNION of by-target aggregation on the post's host instance and a
	 * per-author fan-out over `{viewer} ∪ {followed DIDs}` — so a post hosted on
	 * a plain syr instance (no by-target endpoint) still shows the interactions
	 * syr itself would show. Writes always go to the caller's own instance;
	 * comments are signed server-side.
	 */
	const {
		postDid,
		postId,
		hostBase
	}: {
		postDid: string;
		postId: string;
		/** The post-host instance base URL (where comments are aggregated). */
		hostBase: string;
	} = $props();

	const auth = getAuth();
	const myDid = $derived(auth.identity?.did);
	const myInstance = $derived(auth.identity?.syr_instance_url);
	const canReact = $derived(!!myDid);

	// Block/ignore masking, mirroring `message-item.svelte`: a comment from a
	// blocked/ignored identity is collapsed behind a "hidden by your
	// preferences" line with a per-comment "View anyway" reveal (remembered
	// only for this mount). Replies underneath stay visible — only the masked
	// author's own comment body + actions are hidden.
	const relations = getRelations();
	const revealed = new SvelteSet<string>();

	function hiddenReason(did: string): 'blocked' | 'ignored' | null {
		if (relations.isBlocked(did)) return 'blocked';
		if (relations.isIgnored(did)) return 'ignored';
		return null;
	}

	interface Node {
		comment: PublicComment;
		children: Node[];
	}

	let comments = $state<PublicComment[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	// Reactions for the whole thread, keyed `type:did:id`, fed to each bar.
	const reactionMap = new SvelteMap<string, PublicReaction[]>();
	let fanout: FanoutTarget[] = [];
	const rkey = (type: ReactionParentType, did: string, id: string) => `${type}:${did}:${id}`;
	function reactionsFor(type: ReactionParentType, did: string, id: string): PublicReaction[] {
		return reactionMap.get(rkey(type, did, id)) ?? [];
	}

	let newContent = $state('');
	let replyKey = $state<string | null>(null);
	let replyContent = $state('');
	let editKey = $state<string | null>(null);
	let editContent = $state('');

	const key = (c: PublicComment) => `${c.did}:${c.local_id}`;

	const tree = $derived.by<Node[]>(() => {
		const nodes = new Map<string, Node>();
		for (const c of comments) nodes.set(key(c), { comment: c, children: [] });
		const roots: Node[] = [];
		for (const c of comments) {
			const n = nodes.get(key(c))!;
			const chain = c.ancestor_chain ?? [];
			const parent = chain.length ? nodes.get(chain[chain.length - 1]) : null;
			if (parent) parent.children.push(n);
			else roots.push(n);
		}
		return roots;
	});

	async function load() {
		if (!hostBase || !postDid || !postId) {
			loading = false;
			return;
		}
		try {
			const following = await ensureFollowGraph();
			fanout = buildFanoutSet(
				myDid ? { did: myDid, base: myInstance } : null,
				following
			);
			comments = await fetchComments(hostBase, postDid, postId, fanout);
			await loadReactions();
		} catch {
			/* keep last-known on transient failure */
		}
		loading = false;
	}

	/** (Re)load reactions for the post + every currently-loaded comment. */
	async function loadReactions() {
		const targets: { type: ReactionParentType; did: string; id: string }[] = [
			{ type: 'post', did: postDid, id: postId },
			...comments.map((c) => ({ type: 'comment' as const, did: c.did, id: c.local_id }))
		];
		const map = await fetchReactionsForThread(hostBase, targets, fanout);
		for (const [k, v] of map) reactionMap.set(k, v);
	}

	async function handleToggle(body: ReactionCreate) {
		if (!canReact) return;
		try {
			await toggleReaction(body);
			const fresh = await reloadTargetReactions(
				hostBase,
				body.parent_type,
				body.parent_did,
				body.parent_id,
				fanout
			);
			reactionMap.set(rkey(body.parent_type, body.parent_did, body.parent_id), fresh);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to react');
		}
	}

	onMount(load);

	async function submitRoot() {
		const content = newContent.trim();
		if (!content || busy) return;
		busy = true;
		try {
			await createComment({
				post_did: postDid,
				post_id: postId,
				ancestor_chain: [],
				content,
				visibility: 'public',
				status: 'completed'
			});
			newContent = '';
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to comment');
		}
		busy = false;
	}

	async function submitReply(parent: PublicComment) {
		const content = replyContent.trim();
		if (!content || busy) return;
		busy = true;
		try {
			await createComment({
				post_did: postDid,
				post_id: postId,
				ancestor_chain: [...(parent.ancestor_chain ?? []), key(parent)],
				content,
				visibility: 'public',
				status: 'completed'
			});
			replyContent = '';
			replyKey = null;
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to reply');
		}
		busy = false;
	}

	async function submitEdit(comment: PublicComment) {
		const content = editContent.trim();
		if (!content || busy) return;
		busy = true;
		try {
			await updateComment(comment.did, comment.local_id, { content });
			editKey = null;
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to edit');
		}
		busy = false;
	}

	async function remove(comment: PublicComment) {
		if (busy) return;
		busy = true;
		try {
			await deleteComment(comment.did, comment.local_id);
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to delete');
		}
		busy = false;
	}

	function startReply(c: PublicComment) {
		replyKey = key(c);
		replyContent = '';
		editKey = null;
	}
	function startEdit(c: PublicComment) {
		editKey = key(c);
		editContent = c.content;
		replyKey = null;
	}

	function authorName(did: string): string {
		return displayName(resolveProfile(did, hostBase), did);
	}
	function authorAvatar(did: string): string | undefined {
		return resolveProfile(did, hostBase).avatar_url || undefined;
	}
	function fmt(iso: string): string {
		try {
			return new Date(iso).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return '';
		}
	}
</script>

{#snippet composer(value: string, onInput: (v: string) => void, onSubmit: () => void, label: string, onCancel?: () => void)}
	<div class="flex flex-col gap-2">
		<textarea
			value={value}
			oninput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
			placeholder="Write a comment…"
			rows="2"
			class="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
		></textarea>
		<div class="flex items-center gap-2">
			<Button size="sm" disabled={busy || !value.trim()} onclick={onSubmit}>{label}</Button>
			{#if onCancel}
				<Button size="sm" variant="ghost" disabled={busy} onclick={onCancel}>Cancel</Button>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet node(n: Node, depth: number)}
	{@const c = n.comment}
	{@const mine = c.did === myDid}
	{@const reason = hiddenReason(c.did)}
	{@const masked = !!reason && !revealed.has(key(c))}
	<div style="margin-left: {Math.min(depth, 4) * 16}px" class="mt-3">
		{#if masked}
			<div class="flex items-center gap-2 rounded bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
				<EyeOff class="size-3.5 shrink-0" />
				<span class="italic">Hidden by your preferences</span>
				<span class="truncate font-mono text-[10px] opacity-70" title={c.did}>
					{c.did.slice(0, 16)}…
				</span>
				<button
					type="button"
					class="ml-auto shrink-0 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
					onclick={() => revealed.add(key(c))}
				>
					View anyway
				</button>
			</div>
		{:else}
		{#if reason}
			<div class="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<span>Shown from {reason === 'blocked' ? 'a blocked' : 'an ignored'} user</span>
				<button
					type="button"
					class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
					onclick={() => revealed.delete(key(c))}
				>
					<EyeOff class="size-3" /> Hide
				</button>
			</div>
		{/if}
		<div class="flex gap-2 {reason ? 'opacity-80' : ''}">
			{#if authorAvatar(c.did)}
				<img src={proxied(authorAvatar(c.did)!)} alt="" class="mt-0.5 size-6 shrink-0 rounded-full object-cover" />
			{:else}
				<div class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
					{authorName(c.did).slice(0, 2).toUpperCase()}
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="flex items-baseline gap-2">
					<span class="truncate text-sm font-medium">{authorName(c.did)}</span>
					<time class="text-[11px] text-muted-foreground">{fmt(c.created_at)}</time>
				</div>

				{#if editKey === key(c)}
					{@render composer(
						editContent,
						(v) => (editContent = v),
						() => submitEdit(c),
						'Save',
						() => (editKey = null)
					)}
				{:else}
					<p class="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.content}</p>
				{/if}

				<div class="mt-1 flex items-center gap-3">
					<ReactionBar
						reactions={reactionsFor('comment', c.did, c.local_id)}
						parentType="comment"
						parentDid={c.did}
						parentId={c.local_id}
						onToggle={handleToggle}
						{canReact}
					/>
					{#if myDid}
						<button
							type="button"
							class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
							onclick={() => startReply(c)}
						>
							<Reply class="size-3" /> Reply
						</button>
					{/if}
					{#if mine}
						<button
							type="button"
							class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
							onclick={() => startEdit(c)}
						>
							<Pencil class="size-3" /> Edit
						</button>
						<button
							type="button"
							class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
							onclick={() => remove(c)}
						>
							<Trash2 class="size-3" /> Delete
						</button>
					{/if}
				</div>

				{#if replyKey === key(c)}
					<div class="mt-2">
						{@render composer(
							replyContent,
							(v) => (replyContent = v),
							() => submitReply(c),
							'Reply',
							() => (replyKey = null)
						)}
					</div>
				{/if}
			</div>
		</div>
		{/if}

		{#each n.children as child (key(child.comment))}
			{@render node(child, depth + 1)}
		{/each}
	</div>
{/snippet}

<div class="mt-6">
	<ReactionBar
		reactions={reactionsFor('post', postDid, postId)}
		parentType="post"
		parentDid={postDid}
		parentId={postId}
		onToggle={handleToggle}
		{canReact}
	/>
</div>

<section class="mt-8 border-t pt-6">
	<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold">
		<MessageSquare class="size-4" />
		Comments{comments.length ? ` (${comments.length})` : ''}
	</h2>

	{#if myDid}
		<div class="mb-4">
			{@render composer(newContent, (v) => (newContent = v), submitRoot, 'Comment')}
		</div>
	{:else}
		<p class="mb-4 text-sm text-muted-foreground">Sign in to join the conversation.</p>
	{/if}

	{#if loading}
		<div class="flex justify-center py-8 text-muted-foreground">
			<LoaderCircle class="size-5 animate-spin" />
		</div>
	{:else if tree.length === 0}
		<p class="py-4 text-sm text-muted-foreground">No comments yet.</p>
	{:else}
		<div>
			{#each tree as root (key(root.comment))}
				{@render node(root, 0)}
			{/each}
		</div>
	{/if}
</section>
