<script lang="ts">
	import { ArrowLeft, ExternalLink } from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { resolvePosts, loadMorePosts, type Post } from '@syren/app-core/stores/posts.svelte';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import PostFeed from '@syren/ui/fragments/post-feed.svelte';
	import ProfileHoverCard from '@syren/ui/fragments/profile-hover-card.svelte';
	import SafeLink from '@syren/ui/fragments/safe-link.svelte';

	const relations = getRelations();
	const did = $derived(decodeURIComponent(page.params.did ?? ''));
	const instanceUrl = $derived(
		(page.url.searchParams.get('instance') ?? relations.instanceFor(did)) || undefined
	);

	const profile = $derived(resolveProfile(did, instanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));
	const bundle = $derived(instanceUrl ? resolvePosts(did, instanceUrl) : null);

	const posts = $derived(bundle?.posts ?? []);
	const hasMore = $derived((bundle?.total ?? 0) > posts.length);
	let loadingMore = $state(false);

	async function handleLoadMore() {
		if (!instanceUrl || loadingMore) return;
		loadingMore = true;
		await loadMorePosts(did, instanceUrl, posts.length);
		loadingMore = false;
	}

	function instanceUrlFor(): string | undefined {
		return instanceUrl;
	}
</script>

<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
	<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => history.back()} title="Back">
		<ArrowLeft class="h-4 w-4" />
	</Button>

	<ProfileHoverCard {did} {instanceUrl}>
		<div class="flex items-center gap-2">
			<Avatar.Root class="h-7 w-7">
				{#if profile.avatar_url}
					<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
				{/if}
				<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
			</Avatar.Root>
			<span class="text-sm font-semibold">{name}</span>
		</div>
	</ProfileHoverCard>

	<span class="truncate font-mono text-[11px] text-muted-foreground">{handle}</span>

	{#if profile.web_profile_url}
		<SafeLink href={profile.web_profile_url} class="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
			View on syr
			<ExternalLink class="h-3 w-3" />
		</SafeLink>
	{/if}
</div>

<main class="flex-1 overflow-y-auto">
	<div class="mx-auto max-w-2xl p-6">
		<PostFeed
			{posts}
			loading={bundle?.loading ?? false}
			{hasMore}
			onLoadMore={handleLoadMore}
			instanceUrlFor={() => instanceUrl}
		/>
	</div>
</main>
