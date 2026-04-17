<script lang="ts">
	import { Loader2, FileText } from '@lucide/svelte';
	import { Button } from '@syren/ui/button';
	import PostItem from './post-item.svelte';
	import type { Post } from '$lib/stores/posts.svelte';

	const {
		posts,
		loading = false,
		hasMore = false,
		onLoadMore,
		instanceUrlFor
	}: {
		posts: Post[];
		loading?: boolean;
		hasMore?: boolean;
		onLoadMore?: () => void;
		instanceUrlFor?: (did: string) => string | undefined;
	} = $props();
</script>

<div class="space-y-4">
	{#if loading && posts.length === 0}
		<div class="flex flex-col items-center gap-2 py-12">
			<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
			<p class="text-xs text-muted-foreground">Loading posts…</p>
		</div>
	{:else if posts.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 py-12">
			<FileText class="h-8 w-8 text-muted-foreground/40" />
			<p class="text-sm text-muted-foreground">No posts yet</p>
		</div>
	{:else}
		{#each posts as post (`${post.did}:${post.local_id}`)}
			<PostItem
				{post}
				did={post.did}
				instanceUrl={instanceUrlFor?.(post.did)}
			/>
		{/each}

		{#if hasMore && onLoadMore}
			<div class="flex justify-center pt-2">
				<Button variant="outline" size="sm" disabled={loading} onclick={onLoadMore}>
					{#if loading}
						<Loader2 class="mr-1.5 h-3 w-3 animate-spin" />
					{/if}
					Load more
				</Button>
			</div>
		{/if}
	{/if}
</div>
