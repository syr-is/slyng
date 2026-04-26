<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Popover } from 'bits-ui';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import {
		Crown,
		ExternalLink,
		Newspaper,
		ShieldAlert,
		UserX,
		UserPlus,
		UserCheck,
		UserMinus,
		MessageSquare,
		Ban,
		RotateCcw,
		MoreVertical,
		X,
		Check
	} from '@lucide/svelte';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '@syren/app-core/api';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { resolveStories } from '@syren/app-core/stores/stories.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import StoryViewer from './story-viewer.svelte';
	import SafeLink from './safe-link.svelte';
	import { getActiveProfileCard, setActiveProfileCard } from './active-profile-card.svelte.js';
	import { getMembers, type MemberData } from '@syren/app-core/stores/members.svelte';
	import { getRoles, type RoleData } from '@syren/app-core/stores/roles.svelte';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { getPresenceData, type PresenceStatus } from '@syren/app-core/stores/presence.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { openModeration } from '@syren/app-core/stores/moderation-target.svelte';

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

	const relations = getRelations();
	// If the caller didn't pass an instance URL (e.g. a list of bare DIDs from
	// the relations store), fall back to the relations cache so profiles still
	// resolve.
	const resolvedInstance = $derived(instanceUrl ?? relations.instanceFor(did));
	const profile = $derived(resolveProfile(did, resolvedInstance));
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

	// "Former Member" signal: we're viewing this card inside a server context,
	// the members list has loaded, and the target isn't in it. This captures
	// users who left, were kicked, or were banned — their messages can still
	// appear in the channel history long after they're gone.
	const isFormerMember = $derived(
		!!serverState.activeServerId && memberStore.list.length > 0 && !member && !isOwner
	);

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

	const relationState = $derived(isSelf ? 'self' : relations.state(did));

	let viewerOpen = $state(false);
	let busy = $state(false);

	// ── Card open/close ──
	// Popover is used instead of HoverCard (which is LinkPreview under the
	// hood and ignores controlled `open` on pointer-leave). Popover fully
	// respects controlled state and dismisses on click-outside — exactly
	// what we need. Hover-card UX is re-created with manual timers.
	//
	// `hoverOpen` is derived from a shared rune so only ONE card is open at
	// a time across the whole app — opening this one stamps `activeId = did`
	// on the rune, which immediately makes every other card's `hoverOpen`
	// derivation false and closes them.
	const active = getActiveProfileCard();
	const hoverOpen = $derived(active.value === did);
	let menuOpen = $state(false);
	const cardOpen = $derived(hoverOpen || menuOpen || viewerOpen);

	function openCard() {
		setActiveProfileCard(did);
	}
	function closeCard() {
		if (active.value === did) setActiveProfileCard(null);
	}

	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	const OPEN_DELAY = 300;
	const CLOSE_DELAY = 150;

	function scheduleOpen() {
		cancelTimer();
		hoverTimer = setTimeout(() => { openCard(); }, OPEN_DELAY);
	}

	function scheduleClose() {
		if (menuOpen || viewerOpen) return;
		cancelTimer();
		hoverTimer = setTimeout(() => { closeCard(); }, CLOSE_DELAY);
	}

	function cancelTimer() {
		if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
	}

	function handlePopoverOpenChange(next: boolean) {
		if (!next) {
			// Click-outside dismiss — always close, even if menu was open.
			cancelTimer();
			closeCard();
			menuOpen = false;
		}
	}

	function triggerModeration() {
		openModeration(did, instanceUrl);
	}

	async function sendRequest() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.sendRequest(did);
			toast.success('Friend request sent');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function acceptRequest() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.accept(did);
			toast.success('Friend added');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function declineRequest() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.decline(did);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function cancelOrUnfriend() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.cancelOrRemove(did);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function blockUser() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.block(did);
			toast.success('User blocked');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function unblockUser() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.unblock(did);
			toast.success('User unblocked');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function ignoreUser() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.ignore(did);
			toast.success('User ignored');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function unignoreUser() {
		if (busy) return;
		busy = true;
		try {
			await api.relations.unignore(did);
			toast.success('User unignored');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		busy = false;
	}

	async function sendDm() {
		try {
			const ch = await api.users.createDM(did);
			goto(`/channels/@me/${ch.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to open DM');
		}
	}
</script>

<Popover.Root open={cardOpen} onOpenChange={handlePopoverOpenChange}>
	<Popover.Trigger
		onclick={(e: MouseEvent) => { e.preventDefault(); openCard(); }}
		onpointerenter={(e: PointerEvent) => { if (e.pointerType === 'mouse') scheduleOpen(); }}
		onpointerleave={(e: PointerEvent) => { if (e.pointerType === 'mouse') scheduleClose(); }}
		class={triggerClass}
	>
		{@render children()}
	</Popover.Trigger>
	<Popover.Portal>
	<Popover.Content
		side="right"
		sideOffset={8}
		avoidCollisions={true}
		collisionPadding={12}
		onpointerenter={(e: PointerEvent) => { if (e.pointerType === 'mouse') cancelTimer(); }}
		onpointerleave={(e: PointerEvent) => { if (e.pointerType === 'mouse') scheduleClose(); }}
		class="z-50 w-80 max-w-[calc(100vw-1.5rem)] origin-(--bits-popover-content-transform-origin) rounded-md p-0 bg-popover text-popover-foreground border border-border shadow-lg outline-none animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
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
				<div class="flex flex-wrap items-center gap-1">
					<span class="truncate text-base font-semibold">
						{nickname || name}
					</span>
					{#if isOwner}
						<Crown class="h-4 w-4 text-amber-500" />
					{/if}
					{#if isFormerMember}
						<span
							class="inline-flex items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
							title="No longer a member of this server"
						>
							<UserX class="h-3 w-3" />
							Former member
						</span>
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
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<SafeLink
						href={profile.web_profile_url}
						class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
					>
						<Newspaper class="h-3 w-3" />
						Open profile
						<ExternalLink class="h-3 w-3" />
					</SafeLink>
				</div>
			{/if}

			{#if canModerate}
				<Button variant="outline" size="sm" class="mt-1 w-full" onclick={triggerModeration}>
					<ShieldAlert class="mr-1.5 h-4 w-4" />
					Moderation View
				</Button>
			{/if}

			{#if !isSelf}
				<div class="flex items-center gap-1 pt-1">
					<div class="flex-1">
						{#if relationState === 'friend' || relationState === 'friend_ignored'}
							<Button variant="outline" size="sm" disabled={busy} onclick={cancelOrUnfriend} class="w-full">
								<UserMinus class="mr-1.5 h-4 w-4" />
								Unfriend
							</Button>
						{:else if relationState === 'outgoing_pending'}
							<Button variant="outline" size="sm" disabled={busy} onclick={cancelOrUnfriend} class="w-full">
								<X class="mr-1.5 h-4 w-4" />
								Cancel request
							</Button>
						{:else if relationState === 'incoming_pending'}
							<div class="flex gap-1">
								<Button size="sm" disabled={busy} onclick={acceptRequest} class="flex-1">
									<Check class="mr-1 h-4 w-4" />
									Accept
								</Button>
								<Button variant="outline" size="sm" disabled={busy} onclick={declineRequest} class="flex-1">
									<X class="mr-1 h-4 w-4" />
									Decline
								</Button>
							</div>
						{:else if relationState === 'blocked'}
							<Button variant="outline" size="sm" disabled={busy} onclick={unblockUser} class="w-full">
								<RotateCcw class="mr-1.5 h-4 w-4" />
								Unblock
							</Button>
						{:else}
							<Button variant="outline" size="sm" disabled={busy} onclick={sendRequest} class="w-full">
								<UserPlus class="mr-1.5 h-4 w-4" />
								Send friend request
							</Button>
						{/if}
					</div>
					<DropdownMenu.Root bind:open={menuOpen}>
						<DropdownMenu.Trigger
							class="rounded-md border border-input p-1.5 hover:bg-accent"
							title="More"
						>
							<MoreVertical class="h-4 w-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-48" align="end">
							{#if relationState !== 'blocked'}
								<DropdownMenu.Item onclick={sendDm}>
									<MessageSquare class="mr-2 h-4 w-4" />
									Send message
								</DropdownMenu.Item>
							{/if}
							{#if relations.isIgnored(did)}
								<DropdownMenu.Item onclick={unignoreUser}>
									<UserCheck class="mr-2 h-4 w-4" />
									Unignore
								</DropdownMenu.Item>
							{:else if relationState !== 'blocked'}
								<DropdownMenu.Item onclick={ignoreUser}>
									<UserX class="mr-2 h-4 w-4" />
									Ignore
								</DropdownMenu.Item>
							{/if}
							<DropdownMenu.Separator />
							{#if relationState === 'blocked'}
								<DropdownMenu.Item onclick={unblockUser}>
									<RotateCcw class="mr-2 h-4 w-4" />
									Unblock
								</DropdownMenu.Item>
							{:else}
								<DropdownMenu.Item class="text-destructive focus:text-destructive" onclick={blockUser}>
									<Ban class="mr-2 h-4 w-4" />
									Block
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}
		</div>
	</Popover.Content>
	</Popover.Portal>
</Popover.Root>

{#if viewerOpen}
	<StoryViewer
		open={true}
		{did}
		{instanceUrl}
		onClose={() => (viewerOpen = false)}
	/>
{/if}
