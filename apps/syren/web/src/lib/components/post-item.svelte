<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { FileText, Image as ImageIcon } from '@lucide/svelte';
	import type { Post } from '$lib/stores/posts.svelte';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { proxied } from '$lib/utils/proxy';
	import SafeMedia from './safe-media.svelte';
	import ProfileHoverCard from './profile-hover-card.svelte';

	const {
		post,
		did,
		instanceUrl
	}: {
		post: Post;
		did: string;
		instanceUrl?: string;
	} = $props();

	const profile = $derived(resolveProfile(did, instanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));

	function formatAgo(iso: string): string {
		const then = new Date(iso).getTime();
		const delta = Date.now() - then;
		const m = Math.floor(delta / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d}d ago`;
		return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	const hasMedia = $derived(post.type === 'media' && !!post.media_urls?.length);
</script>

<article class="rounded-lg border border-border bg-card">
	<!-- Author row -->
	<div class="flex items-center gap-2.5 px-4 pt-3 pb-2">
		<ProfileHoverCard {did} {instanceUrl}>
			<Avatar.Root class="h-9 w-9 shrink-0">
				{#if profile.avatar_url}
					<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
				{/if}
				<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
			</Avatar.Root>
		</ProfileHoverCard>
		<div class="min-w-0 flex-1">
			<ProfileHoverCard {did} {instanceUrl}>
				<span class="truncate text-sm font-medium text-foreground hover:underline">{name}</span>
			</ProfileHoverCard>
			<p class="truncate font-mono text-[11px] text-muted-foreground">
				{handle} · {formatAgo(post.created_at)}
			</p>
		</div>
		{#if post.type === 'media'}
			<ImageIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
		{:else}
			<FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
		{/if}
	</div>

	<!-- Content -->
	<div class="space-y-2 px-4 pb-3">
		{#if post.title}
			<h3 class="text-sm font-semibold text-foreground">{post.title}</h3>
		{/if}
		{#if post.description}
			<p class="whitespace-pre-wrap text-sm text-foreground/90">{post.description}</p>
		{/if}
	</div>

	<!-- Media grid -->
	{#if hasMedia}
		{@const urls = post.media_urls ?? []}
		<div
			class="overflow-hidden border-t border-border {urls.length === 1
				? ''
				: 'grid gap-0.5 ' + (urls.length === 2 ? 'grid-cols-2' : urls.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}"
		>
			{#each urls as url, i (url)}
				<SafeMedia
					src={url}
					alt={post.title ?? `Media ${i + 1}`}
					as="img"
					class="w-full object-cover {urls.length === 1 ? 'max-h-[400px]' : 'aspect-square'}"
				/>
			{/each}
		</div>
	{/if}
</article>
