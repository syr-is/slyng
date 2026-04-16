<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Loader2 } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { getRelations } from '$lib/stores/relations.svelte';
	import { resolveProfile, displayName, watchProfiles, unwatchProfiles } from '$lib/stores/profiles.svelte';
	import { resolveStories, hasStories, type StoryBundle } from '$lib/stores/stories.svelte';
	import { resolvePosts, type Post, type PostBundle } from '$lib/stores/posts.svelte';
	import { proxied } from '$lib/utils/proxy';
	import StoryViewer from '$lib/components/story-viewer.svelte';
	import PostFeed from '$lib/components/post-feed.svelte';

	const relations = getRelations();
	const friendsList = $derived([...relations.friends]);

	// Build { did, instance_url } pairs for friends with known instances.
	const friendPairs = $derived(
		friendsList
			.map((did) => ({ did, instance_url: relations.instanceFor(did) }))
			.filter((p): p is { did: string; instance_url: string } => !!p.instance_url)
	);

	// ── Profile hash watching ──
	// Register friends for federated hash polling so PROFILE_UPDATE events
	// fire when their syr profile/stories/posts change — exactly the same
	// pattern as [serverId]/+layout.svelte does for server members.
	let watchedDids: string[] = [];

	$effect(() => {
		const next = friendPairs;
		const nextDids = new Set(next.map((p) => p.did));
		const currentDids = new Set(watchedDids);

		const toWatch = next.filter((p) => !currentDids.has(p.did));
		const toUnwatch = watchedDids.filter((d) => !nextDids.has(d));

		if (toWatch.length) watchProfiles(toWatch);
		if (toUnwatch.length) unwatchProfiles(toUnwatch);
		watchedDids = [...nextDids];
	});

	onDestroy(() => {
		if (watchedDids.length) unwatchProfiles(watchedDids);
	});

	// ── Stories ──
	// Trigger story resolution as a side effect so the cache fills async.
	// The $derived below reads the cache reactively.
	$effect(() => {
		for (const { did, instance_url } of friendPairs) {
			resolveStories(did, instance_url);
		}
	});

	// Pure reactive read — re-evaluates when SvelteMap cache updates.
	const friendsWithStories = $derived(
		friendsList.filter((did) => hasStories(did))
	);

	// Track whether stories are still loading for at least one friend
	const storiesLoading = $derived(
		friendPairs.some((p) => {
			const bundle: StoryBundle = resolveStories(p.did, p.instance_url);
			return bundle.loading;
		})
	);

	let viewerDid = $state<string | null>(null);
	let viewerInstance = $state<string | undefined>(undefined);
	let viewerOpen = $state(false);

	function openStory(did: string) {
		viewerDid = did;
		viewerInstance = relations.instanceFor(did);
		viewerOpen = true;
	}

	// ── Posts timeline ──
	// Trigger post resolution as a side effect.
	$effect(() => {
		for (const { did, instance_url } of friendPairs) {
			resolvePosts(did, instance_url);
		}
	});

	// Reactively read all friends' post bundles and merge into a timeline.
	const postBundles = $derived(
		friendPairs.map((p) => resolvePosts(p.did, p.instance_url))
	);

	const postsLoading = $derived(postBundles.some((b) => b.loading));

	const timeline = $derived(
		postBundles
			.flatMap((b: PostBundle) => b.posts)
			.sort((a: Post, b: Post) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
	);

	function instanceUrlFor(did: string): string | undefined {
		return relations.instanceFor(did);
	}
</script>

<div class="flex h-12 shrink-0 items-center border-b border-border px-4">
	<h1 class="text-sm font-semibold">Friends · {friendsList.length}</h1>
</div>

<main class="flex-1 overflow-y-auto">
	<div class="mx-auto max-w-2xl space-y-6 p-6">
		{#if friendsList.length === 0}
			<p class="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
				No friends yet. Open someone's profile to send a friend request.
			</p>
		{:else}
			<!-- Stories row -->
			{#if friendsWithStories.length > 0 || storiesLoading}
				<section>
					<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Stories
						{#if storiesLoading}
							<Loader2 class="ml-1 inline h-3 w-3 animate-spin" />
						{/if}
					</h2>
					{#if friendsWithStories.length > 0}
						<div class="flex gap-3 overflow-x-auto pb-2">
							{#each friendsWithStories as did (did)}
								{@const profile = resolveProfile(did, relations.instanceFor(did))}
								{@const name = displayName(profile, did)}
								<button
									type="button"
									onclick={() => openStory(did)}
									class="flex shrink-0 flex-col items-center gap-1"
									title="{name}'s stories"
								>
									<div class="rounded-full p-[3px] bg-gradient-to-tr from-pink-500 via-orange-400 to-yellow-400 transition-transform hover:scale-105">
										<Avatar.Root class="h-14 w-14 border-2 border-background">
											{#if profile.avatar_url}
												<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
											{/if}
											<Avatar.Fallback class="text-sm">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
										</Avatar.Root>
									</div>
									<span class="max-w-[4.5rem] truncate text-[11px] text-muted-foreground">{name}</span>
								</button>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">Checking for stories…</p>
					{/if}
				</section>
			{/if}

			<!-- Posts timeline -->
			<section>
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Feed
					{#if postsLoading}
						<Loader2 class="ml-1 inline h-3 w-3 animate-spin" />
					{/if}
				</h2>
				<PostFeed
					posts={timeline}
					loading={postsLoading}
					{instanceUrlFor}
				/>
			</section>
		{/if}
	</div>
</main>

{#if viewerOpen && viewerDid}
	<StoryViewer
		open={true}
		did={viewerDid}
		instanceUrl={viewerInstance}
		onClose={() => (viewerOpen = false)}
	/>
{/if}
