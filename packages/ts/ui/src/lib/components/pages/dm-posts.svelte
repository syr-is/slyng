<script lang="ts">
	// The "You" page (and any user's profile+posts view) at
	// `/channels/@me/posts/[did]`. Profile header (banner, avatar, name, bio) over
	// an infinite, paginated posts scroller. On your OWN page the avatar opens the
	// story composer (upload/manage) and a "New post" button appears; on someone
	// else's it's read-only, and their avatar opens the story viewer if they have
	// an active 24h reel. `/u/[param]` stays the separate public/federation profile.
	import { ExternalLink, Plus } from '@lucide/svelte';
	import * as Avatar from '@slyng/ui/avatar';
	import * as Dialog from '@slyng/ui/dialog';
	import { Button } from '@slyng/ui/button';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@slyng/app-core/stores/profiles.svelte';
	import { resolvePosts, loadMorePosts } from '@slyng/app-core/stores/posts.svelte';
	import { resolveStories, invalidateStories } from '@slyng/app-core/stores/stories.svelte';
	import { getRelations } from '@slyng/app-core/stores/relations.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import PostFeed from '@slyng/ui/fragments/post-feed.svelte';
	import SafeLink from '@slyng/ui/fragments/safe-link.svelte';
	import StoryViewer from '@slyng/ui/fragments/story-viewer.svelte';
	import StoryComposer from '@slyng/ui/fragments/settings/story-composer.svelte';

	const relations = getRelations();
	const auth = getAuth();
	const did = $derived(decodeURIComponent(page.params.did ?? ''));
	const isOwn = $derived(!!auth.identity?.did && did === auth.identity.did);

	// Bail out to /channels/@me rather than render a degenerate empty state.
	$effect(() => {
		if (!did) goto('/channels/@me', { replaceState: true });
	});

	// Own DID isn't in your own relations map, so fall back to your session instance.
	const instanceUrl = $derived(
		(page.url.searchParams.get('instance') ??
			relations.instanceFor(did) ??
			(isOwn ? auth.identity?.syr_instance_url : undefined)) ||
			undefined
	);

	const profile = $derived(resolveProfile(did, instanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));

	const bundle = $derived(instanceUrl ? resolvePosts(did, instanceUrl) : null);
	const posts = $derived(bundle?.posts ?? []);
	const hasMore = $derived((bundle?.total ?? 0) > posts.length);
	let loadingMore = $state(false);

	const stories = $derived(instanceUrl ? resolveStories(did, instanceUrl) : null);
	const hasActiveStories = $derived((stories?.slides.length ?? 0) > 0);
	const avatarClickable = $derived(isOwn || hasActiveStories);

	let showViewer = $state(false);
	let showComposer = $state(false);

	async function handleLoadMore() {
		if (!instanceUrl || loadingMore) return;
		loadingMore = true;
		await loadMorePosts(did, instanceUrl, posts.length);
		loadingMore = false;
	}

	function onAvatarClick() {
		if (isOwn) showComposer = true;
		else if (hasActiveStories) showViewer = true;
	}
</script>

<!-- Slim top bar (label only — the sidebar handles navigation) -->
<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
	<span class="truncate text-sm font-semibold">{isOwn ? 'You' : name}</span>
</div>

<main class="flex-1 overflow-y-auto">
	<!-- Banner -->
	<div class="h-32 w-full overflow-hidden bg-muted sm:h-44">
		{#if profile.banner_url}
			<img src={proxied(profile.banner_url)} alt="" class="h-full w-full object-cover" draggable="false" />
		{/if}
	</div>

	<div class="mx-auto max-w-2xl px-4">
		<!-- Avatar (overlapping banner) + primary action -->
		<div class="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
			<button
				type="button"
				disabled={!avatarClickable}
				onclick={onAvatarClick}
				class="relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary {avatarClickable
					? 'cursor-pointer'
					: 'cursor-default'} {hasActiveStories
					? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
					: ''}"
				aria-label={isOwn
					? 'Add or manage your story'
					: hasActiveStories
						? `View ${name}'s story`
						: name}
				title={isOwn ? 'Add story' : hasActiveStories ? 'View story' : undefined}
			>
				<Avatar.Root class="size-20 border-4 border-background sm:size-24">
					{#if profile.avatar_url}
						<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
					{/if}
					<Avatar.Fallback class="text-xl">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
				</Avatar.Root>
				{#if isOwn}
					<span
						class="absolute bottom-0.5 right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
					>
						<Plus class="size-3.5" />
					</span>
				{/if}
			</button>

			<div class="flex items-center gap-2 pb-2">
				{#if isOwn}
					<Button size="sm" class="gap-1" onclick={() => goto('/posts/new')}>
						<Plus class="h-4 w-4" /> New post
					</Button>
				{:else if profile.web_profile_url}
					<SafeLink
						href={profile.web_profile_url}
						class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
					>
						View on syr <ExternalLink class="h-3 w-3" />
					</SafeLink>
				{/if}
			</div>
		</div>

		<!-- Identity -->
		<div class="mt-3 space-y-1">
			<h1 class="truncate text-xl font-bold tracking-tight text-foreground">{name}</h1>
			<p class="truncate font-mono text-xs text-muted-foreground">{handle}</p>
			{#if profile.bio}
				<p class="mt-2 text-sm whitespace-pre-wrap text-foreground/90">{profile.bio}</p>
			{/if}
		</div>
	</div>

	<!-- Posts scroller -->
	<div class="mx-auto max-w-2xl px-4 py-6">
		<h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posts</h2>
		<PostFeed
			{posts}
			loading={bundle?.loading ?? false}
			{hasMore}
			onLoadMore={handleLoadMore}
			instanceUrlFor={() => instanceUrl}
		/>
	</div>
</main>

<!-- Watch another user's active reel -->
{#if showViewer}
	<StoryViewer open={showViewer} {did} {instanceUrl} onClose={() => (showViewer = false)} />
{/if}

<!-- Your own story upload / management -->
<Dialog.Root bind:open={showComposer}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Your stories</Dialog.Title>
			<Dialog.Description>Add a slide or remove one — stories stay public for 24 hours.</Dialog.Description>
		</Dialog.Header>
		<StoryComposer onChanged={() => invalidateStories(did)} />
	</Dialog.Content>
</Dialog.Root>
