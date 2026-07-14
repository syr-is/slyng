<script module lang="ts">
	// Installed at most once across all instances (adding the hook per-mount would
	// stack duplicates on every navigation).
	let sanitizeHookInstalled = false;
</script>

<script lang="ts">
	// Public read view for a single post: `/p/[did]/[id]`. Resolves the post's
	// host instance (query `?instance=`, else the relations map, else — for your
	// own did — your session instance), fetches the public post through the
	// federated proxy, and renders it. Blog bodies render Markdown via marked +
	// DOMPurify (media urls rewritten through `proxied()` so no viewer IP leaks);
	// media posts render a gallery. Logged-out accessible (mirrors /u/[param]).
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveManifest } from '@syren/app-core/stores/profiles.svelte';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	// Aliased: svelte-package names this component `PublicPost` from the
	// filename, and an identically-named type import collides in the generated
	// .d.ts, breaking the default export under verbatimModuleSyntax.
	import type { PublicPost as PublicPostData } from '@syren/types';
	import { LoaderCircle } from '@lucide/svelte';
	import CommentThread from '../fragments/comment-thread.svelte';

	const auth = getAuth();
	const relations = getRelations();

	const did = $derived(page.params.did ? decodeURIComponent(page.params.did) : '');
	const localId = $derived(page.params.id ? decodeURIComponent(page.params.id) : '');
	const instanceUrl = $derived(
		page.url.searchParams.get('instance') ??
			relations.instanceFor?.(did) ??
			(did === auth.identity?.did ? auth.identity?.syr_instance_url : undefined) ??
			undefined
	);

	let loading = $state(true);
	let error = $state<string | null>(null);
	let post = $state<PublicPostData | null>(null);

	const profile = $derived(did && instanceUrl ? resolveProfile(did, instanceUrl) : null);
	const authorName = $derived(profile ? displayName(profile, did) : did.slice(0, 12));

	// Render Markdown → sanitized HTML, rewriting media/link attrs through the proxy.
	const bodyHtml = $derived.by(() => {
		if (!post || post.type !== 'blog' || !post.content) return '';
		const raw = marked.parse(post.content, { async: false }) as string;
		return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
	});

	// DOMPurify hook: proxy remote media, force safe external links. Registered
	// once (module-scoped guard); guarded for SSR-less client.
	if (!sanitizeHookInstalled && typeof window !== 'undefined') {
		sanitizeHookInstalled = true;
		DOMPurify.addHook('afterSanitizeAttributes', (node) => {
			const el = node as Element;
			if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
				const src = el.getAttribute('src');
				if (src) el.setAttribute('src', proxied(src));
			}
			if (el.tagName === 'A') {
				el.setAttribute('target', '_blank');
				el.setAttribute('rel', 'noopener noreferrer nofollow');
			}
		});
	}

	function isVideo(url: string): boolean {
		return /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url);
	}

	async function load(): Promise<void> {
		loading = true;
		error = null;
		post = null;
		if (!did || !localId) {
			error = 'Missing post reference.';
			loading = false;
			return;
		}
		if (!instanceUrl) {
			error = "Couldn't determine which instance hosts this post.";
			loading = false;
			return;
		}
		try {
			const manifest = await resolveManifest(did, instanceUrl);
			const base = manifest.endpoints.posts; // .../api/public/posts/<did>
			const url = `${base}/${encodeURIComponent(localId)}`;
			const res = await fetch(proxied(url), { headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(res.status === 404 ? 'Post not found.' : 'Failed to load post.');
			const body = (await res.json()) as { data: PublicPostData };
			post = body.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load post.';
		}
		loading = false;
	}

	// Re-fetch whenever the route target changes.
	$effect(() => {
		void did;
		void localId;
		void instanceUrl;
		void load();
	});

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return '';
		}
	}
</script>

<article class="mx-auto w-full max-w-2xl px-4 py-8">
	{#if loading}
		<div class="flex justify-center py-16 text-muted-foreground">
			<LoaderCircle class="size-6 animate-spin" />
		</div>
	{:else if error}
		<div class="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
			{error}
		</div>
	{:else if post}
		<header class="mb-6 border-b pb-4">
			{#if post.title}
				<h1 class="text-2xl font-bold tracking-tight">{post.title}</h1>
			{/if}
			{#if post.description}
				<p class="mt-1 text-muted-foreground">{post.description}</p>
			{/if}
			<div class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
				{#if profile?.avatar_url}
					<img src={proxied(profile.avatar_url)} alt="" class="size-5 rounded-full object-cover" />
				{/if}
				<span>{authorName}</span>
				<span aria-hidden="true">·</span>
				<time>{formatDate(post.created_at)}</time>
			</div>
		</header>

		{#if post.type === 'blog'}
			<!-- eslint-disable-next-line svelte/no-at-html-tags — sanitized by DOMPurify above -->
			<div class="post-body">{@html bodyHtml}</div>
		{:else if post.media_urls?.length}
			<div
				class="grid gap-3 {post.display_mode === 'carousel'
					? 'grid-flow-col auto-cols-[80%] overflow-x-auto'
					: 'grid-cols-1 sm:grid-cols-2'}"
			>
				{#each post.media_urls as url (url)}
					{#if isVideo(url)}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={proxied(url)} controls preload="metadata" class="w-full rounded-lg"></video>
					{:else}
						<img src={proxied(url)} alt="" class="w-full rounded-lg" loading="lazy" />
					{/if}
				{/each}
			</div>
		{/if}

		{#if instanceUrl}
			<CommentThread postDid={did} postId={localId} hostBase={instanceUrl} />
		{/if}
	{/if}
</article>

<style>
	:global(.post-body) {
		font-size: 1rem;
		line-height: 1.7;
	}
	:global(.post-body h1) {
		font-size: 1.6rem;
		font-weight: 700;
		margin: 1em 0 0.4em;
	}
	:global(.post-body h2) {
		font-size: 1.3rem;
		font-weight: 600;
		margin: 0.9em 0 0.4em;
	}
	:global(.post-body p) {
		margin: 0.7em 0;
	}
	:global(.post-body ul),
	:global(.post-body ol) {
		margin: 0.7em 0;
		padding-left: 1.5em;
	}
	:global(.post-body ul) {
		list-style: disc;
	}
	:global(.post-body ol) {
		list-style: decimal;
	}
	:global(.post-body blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 1em;
		color: var(--muted-foreground);
		margin: 0.8em 0;
	}
	:global(.post-body pre) {
		background: var(--muted);
		border-radius: 0.5rem;
		padding: 0.8em 1em;
		overflow-x: auto;
		font-size: 0.9em;
	}
	:global(.post-body code) {
		font-family: ui-monospace, monospace;
		font-size: 0.9em;
	}
	:global(.post-body img),
	:global(.post-body video) {
		max-width: 100%;
		border-radius: 0.6rem;
		margin: 0.8em 0;
	}
	:global(.post-body a) {
		color: var(--primary);
		text-decoration: underline;
	}
	:global(.post-body hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.2em 0;
	}
</style>
