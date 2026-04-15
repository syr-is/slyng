<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as HoverCard from '@syren/ui/hover-card';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Crown, ExternalLink, ShieldAlert } from '@lucide/svelte';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { resolveStories } from '$lib/stores/stories.svelte';
	import { proxied } from '$lib/utils/proxy';
	import StoryViewer from './story-viewer.svelte';
	import { getMembers, type MemberData } from '$lib/stores/members.svelte';
	import { getRoles, type RoleData } from '$lib/stores/roles.svelte';
	import { getServerState } from '$lib/stores/servers.svelte';
	import { getPresenceData, type PresenceStatus } from '$lib/stores/presence.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { openModeration } from '$lib/stores/moderation-target.svelte';

	const STATUS_COLORS: Record<PresenceStatus, string> = {
		online: 'bg-green-500',
		idle: 'bg-yellow-500',
		dnd: 'bg-red-500',
		invisible: 'bg-gray-400',
		offline: 'bg-gray-400'
	};

	const STATUS_LABELS: Record<PresenceStatus, string> = {
		online: 'Online',
		idle: 'Idle',
		dnd: 'Do Not Disturb',
		invisible: 'Offline',
		offline: 'Offline'
	};

	const {
		did,
		instanceUrl,
		triggerClass = 'inline-flex cursor-pointer',
		children
	}: {
		did: string;
		instanceUrl?: string;
		triggerClass?: string;
		children: Snippet;
	} = $props();

	const profile = $derived(resolveProfile(did, instanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));
	const presence = $derived(getPresenceData(did));

	// Lazy-fetch stories only once the card is open (resolve still cheap if cached)
	const stories = $derived(resolveStories(did, instanceUrl));
	const hasActiveStories = $derived(stories.slides.length > 0);

	const memberStore = getMembers();
	const roleStore = getRoles();
	const serverState = getServerState();

	const member = $derived<MemberData | undefined>(
		memberStore.list.find((m) => m.user_id === did)
	);
	const isOwner = $derived(!!serverState.activeServerOwnerId && did === serverState.activeServerOwnerId);

	const memberRolesList = $derived.by<RoleData[]>(() => {
		if (!member?.role_ids?.length) return [];
		const ids = member.role_ids.map((r) => String(r));
		return roleStore.list
			.filter((r) => ids.includes(r.id) && !r.is_default)
			.sort((a, b) => b.position - a.position);
	});

	function formatJoinDate(raw: unknown): string | null {
		if (!raw) return null;
		const d = new Date(raw as string);
		if (isNaN(d.getTime())) return null;
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	const joinedAt = $derived(formatJoinDate((member as any)?.joined_at));
	const nickname = $derived((member as any)?.nickname as string | undefined);

	const perms = getPerms();
	const auth = getAuth();
	const isSelf = $derived(did === auth.identity?.did);
	const canModerate = $derived(
		!isSelf && (perms.canKick || perms.canBan || perms.canManageRoles || perms.canManageMessages)
	);

	let viewerOpen = $state(false);

	function triggerModeration() {
		openModeration(did, instanceUrl);
	}
</script>

<HoverCard.Root openDelay={300} closeDelay={150}>
	<HoverCard.Trigger>
		{#snippet child({ props }: { props: Record<string, unknown> })}
			<span {...props} class={triggerClass}>
				{@render children()}
			</span>
		{/snippet}
	</HoverCard.Trigger>
	<HoverCard.Content
		side="right"
		sideOffset={8}
		class="w-80 p-0 bg-popover text-popover-foreground border border-border shadow-lg"
	>
		<!-- Banner -->
		<div
			class="relative h-20 w-full overflow-hidden rounded-t-md {profile.banner_url ? '' : 'bg-gradient-to-br from-primary/30 to-primary/10'}"
		>
			{#if profile.banner_url}
				<img src={proxied(profile.banner_url)} alt="" class="h-full w-full object-cover" />
			{/if}
		</div>

		<!-- Avatar w/ optional stories ring -->
		<div class="relative -mt-10 px-4">
			<div class="relative inline-block">
				{#if hasActiveStories}
					<button
						type="button"
						onclick={() => (viewerOpen = true)}
						class="block rounded-full p-[3px] bg-gradient-to-tr from-pink-500 via-orange-400 to-yellow-400 transition-transform hover:scale-105"
						title="{stories.slides.length} active {stories.slides.length === 1 ? 'story' : 'stories'}"
					>
						<Avatar.Root class="h-20 w-20 border-4 border-popover">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-lg">
								{name.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
					</button>
				{:else}
					<Avatar.Root class="h-20 w-20 border-4 border-popover">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
						{/if}
						<Avatar.Fallback class="text-lg">
							{name.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
				{/if}
				<div
					class="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full border-[3px] border-popover {STATUS_COLORS[presence.status]}"
					title={STATUS_LABELS[presence.status]}
				></div>
			</div>
		</div>

		<!-- Body -->
		<div class="space-y-2 px-4 pb-4 pt-2 text-left">
			<div class="space-y-0.5">
				<div class="flex items-center gap-1">
					<span class="truncate text-base font-semibold">
						{nickname || name}
					</span>
					{#if isOwner}
						<Crown class="h-4 w-4 text-amber-500" />
					{/if}
				</div>
				{#if nickname && nickname !== name}
					<p class="truncate text-sm text-muted-foreground">{name}</p>
				{/if}
				<p class="truncate font-mono text-xs text-muted-foreground">{handle}</p>
			</div>

			{#if presence.custom_status || presence.custom_emoji}
				<div class="rounded bg-muted/50 px-2 py-1 text-xs">
					{presence.custom_emoji ?? ''}
					{presence.custom_status ?? ''}
				</div>
			{/if}

			{#if profile.bio}
				<div>
					<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">About</p>
					<p class="mt-0.5 text-xs whitespace-pre-wrap">{profile.bio}</p>
				</div>
			{/if}

			{#if memberRolesList.length > 0}
				<div>
					<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Roles</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each memberRolesList as r}
							<span
								class="rounded px-1.5 py-0.5 text-[10px]"
								style="background-color: {(r.color || '#99aab5')}33; color: {r.color || '#99aab5'}"
							>{r.name}</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if joinedAt}
				<div>
					<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Member Since</p>
					<p class="text-xs">{joinedAt}</p>
				</div>
			{/if}

			{#if profile.web_profile_url}
				<a
					href={profile.web_profile_url}
					target="_blank"
					rel="noopener"
					class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
				>
					View full profile
					<ExternalLink class="h-3 w-3" />
				</a>
			{/if}

			{#if canModerate}
				<Button variant="outline" size="sm" class="mt-1 w-full" onclick={triggerModeration}>
					<ShieldAlert class="mr-1.5 h-4 w-4" />
					Moderation View
				</Button>
			{/if}
		</div>
	</HoverCard.Content>
</HoverCard.Root>

{#if viewerOpen}
	<StoryViewer
		open={true}
		{did}
		{instanceUrl}
		onClose={() => (viewerOpen = false)}
	/>
{/if}
