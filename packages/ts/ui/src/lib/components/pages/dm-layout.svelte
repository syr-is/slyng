<script lang="ts">
	import { toggleMode } from 'mode-watcher';
	import { onDestroy, onMount } from 'svelte';
	import { MessagesSquare, UserPlus, Users, EyeOff, CircleUser, HardDrive } from '@lucide/svelte';
	import { Separator } from '@syren/ui/separator';
	import * as Avatar from '@syren/ui/avatar';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import NavUser from '@syren/ui/fragments/nav-user.svelte';
	import { api } from '@syren/app-core/api';
	import { normalizeDmChannel } from '@syren/app-core/stores/normalize';
	import { setActiveServer } from '@syren/app-core/stores/servers.svelte';
	import { clearRoles } from '@syren/app-core/stores/roles.svelte';
	import { clearMembers } from '@syren/app-core/stores/members.svelte';
	import { clearServerPerms } from '@syren/app-core/stores/perms.svelte';
	import { clearMessages } from '@syren/app-core/stores/messages.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { page } from '$app/state';
	import { onWsEvent } from '@syren/app-core/stores/ws.svelte';
	import { WsOp } from '@syren/types';
	import { setPageSidebar } from '@syren/ui/fragments/swipe-layout';

	interface DMChannel {
		id: string;
		type: string;
		last_message_at?: string;
		other_user_id: string | null;
		other_user_instance_url?: string | null;
		is_blocked: boolean;
		is_ignored: boolean;
	}

	let { children } = $props();
	let dmChannels = $state<DMChannel[]>([]);
	const auth = getAuth();
	const relations = getRelations();

	async function refreshDms() {
		try {
			dmChannels = (await api.users.dmChannels()).map(normalizeDmChannel);
		} catch (err) {
			console.error('[dm-layout] dmChannels failed', err);
			toast.error(err instanceof Error ? err.message : 'Failed to load DMs');
		}
	}

	// `onWsEvent` returns an unsubscribe fn; collect them so onDestroy
	// can run them. Without this, every mount stacks another listener on
	// the global WS bus and a single event fans out to N copies of
	// refreshDms() for the rest of the session.
	const wsUnsubs: Array<() => void> = [];

	onMount(async () => {
		// DM context has no server, so every server-scoped store has to be
		// emptied — otherwise role colors, role pills, owner crowns, and
		// "former member" badges from the previously-viewed server leak into
		// rendering for DM partners. Mirrors the cleanup set at the top of
		// `server-layout.svelte:loadServer`, just inverted: clear only, no
		// subsequent populate. `setActiveServer(null)` already resets the
		// servers store itself (channels, categories, owner), but the roles /
		// members / perms stores live in their own modules and don't watch
		// the servers store — they need explicit clearing.
		setActiveServer(null);
		clearServerPerms();
		clearRoles();
		clearMembers();
		// Same rationale as server-layout: wipe the message pane so a
		// previously-viewed server channel can't paint while we mount the
		// DM channel page. dm-channel.svelte's gate (below) is the
		// backstop; this prevents even the brief first-frame flash.
		clearMessages();
		// Hand the DM-list sidebar off to (app)/+layout's SwipeLayout
		// drawer. It used to render inline next to the main panel, which
		// crowded the main view on mobile (the user saw both side-by-side
		// with no way to swipe between them).
		setPageSidebar(dmSidebar);
		// Keep the DM list in sync when new DM channels are created or
		// when the actor's relations change (blocking / ignoring flips
		// is_blocked / is_ignored on each row).
		wsUnsubs.push(
			onWsEvent(WsOp.DM_CHANNEL_CREATE, () => void refreshDms()),
			onWsEvent(WsOp.BLOCK_UPDATE, () => void refreshDms()),
			onWsEvent(WsOp.IGNORE_UPDATE, () => void refreshDms())
		);
		await refreshDms();
	});

	onDestroy(() => {
		setPageSidebar(undefined);
		for (const unsub of wsUnsubs) unsub();
		wsUnsubs.length = 0;
	});

	// Main list: all NON-ignored DMs. Ignored DMs live in the dedicated
	// /channels/@me/ignored tab.
	const visibleDms = $derived(dmChannels.filter((c) => !c.is_ignored));

	async function openFriendDm(did: string) {
		try {
			// Pass the instance URL so the API can stub a federated user
			// row on first contact — without it the backend short-circuits
			// the upsert and downstream operations lose the federation
			// linkage.
			const ch = await api.users.createDM(did, relations.instanceFor(did));
			goto(`/channels/@me/${ch.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to open DM');
		}
	}

	async function handleSignOut() {
		try {
			await api.auth.logout();
		} catch { /* best effort */ }
		window.location.href = '/login';
	}

	const incomingCount = $derived(relations.incoming.size);

	const onFriends = $derived(page.url.pathname.startsWith('/channels/@me/friends'));
	const onRequests = $derived(page.url.pathname.startsWith('/channels/@me/requests'));
	const onIgnored = $derived(page.url.pathname.startsWith('/channels/@me/ignored'));
	const onPosts = $derived(page.url.pathname.startsWith('/channels/@me/posts'));
	const onDms = $derived(!onFriends && !onRequests && !onIgnored && !onPosts);

	const myDid = $derived(auth.identity?.did);
	const tabs = $derived([
		// Your own profile + posts + stories page ("You"), pinned to the top (own DID only).
		...(myDid
			? [
					{ href: `/channels/@me/posts/${encodeURIComponent(myDid)}`, label: 'You', icon: CircleUser, match: (p: string) => p.startsWith('/channels/@me/posts') },
					{ href: '/channels/@me/library', label: 'Files', icon: HardDrive, match: (p: string) => p.startsWith('/channels/@me/library') }
				]
			: []),
		{ href: '/channels/@me', label: 'Direct Messages', icon: MessagesSquare, match: (p: string) => p === '/channels/@me' || /^\/channels\/@me\/(?!friends|requests|ignored|posts|library)/.test(p) },
		{ href: '/channels/@me/friends', label: 'Friends', icon: Users, match: (p: string) => p.startsWith('/channels/@me/friends') },
		{ href: '/channels/@me/requests', label: 'Requests', icon: UserPlus, badge: incomingCount, match: (p: string) => p.startsWith('/channels/@me/requests') },
		{ href: '/channels/@me/ignored', label: 'Ignored', icon: EyeOff, match: (p: string) => p.startsWith('/channels/@me/ignored') }
	]);
</script>

{#snippet dmSidebar()}
	<div class="flex h-full w-60 flex-col border-r border-border bg-sidebar">
		<div class="flex h-12 items-center border-b border-sidebar-border px-4">
			<span class="text-sm font-semibold text-sidebar-foreground">Direct Messages</span>
		</div>

		<!-- Section nav -->
		<nav class="space-y-0.5 px-2 py-2">
			{#each tabs as tab (tab.href)}
				{@const Icon = tab.icon}
				{@const active = tab.match(page.url.pathname)}
				<a
					href={tab.href}
					class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors
						{active
							? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
							: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
				>
					<span class="flex items-center gap-2">
						<Icon class="h-4 w-4" />
						{tab.label}
					</span>
					{#if tab.badge && tab.badge > 0}
						<span class="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
							{tab.badge}
						</span>
					{/if}
				</a>
			{/each}
		</nav>

		<Separator />

		<!-- Context-aware sidebar list: DMs, friends, incoming requests, or ignored
			 depending on which tab is active. Each tab gets a relevant list so the
			 sidebar is never empty / useless. -->
		<div class="flex-1 overflow-y-auto px-2 py-2">
			{#if onDms || onPosts}
				{#each visibleDms as channel (channel.id)}
					{@const did = channel.other_user_id}
					{@const profile = did
						? resolveProfile(did, channel.other_user_instance_url ?? relations.instanceFor(did))
						: null}
					{@const name = did && profile ? displayName(profile, did) : 'Direct Message'}
					<a
						href="/channels/@me/{channel.id}"
						class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground {channel.is_blocked ? 'opacity-70' : ''}"
					>
						<Avatar.Root class="h-8 w-8">
							{#if profile?.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<span class="truncate">{name}</span>
						{#if channel.is_blocked}
							<span class="ml-auto rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-destructive">blocked</span>
						{/if}
					</a>
				{/each}
				{#if visibleDms.length === 0}
					<p class="px-2 py-4 text-xs text-sidebar-foreground/50">No conversations yet</p>
				{/if}
			{:else if onFriends}
				{#each [...relations.friends] as did (did)}
					{@const profile = resolveProfile(did, relations.instanceFor(did))}
					{@const name = displayName(profile, did)}
					<button
						type="button"
						onclick={() => openFriendDm(did)}
						class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
					>
						<Avatar.Root class="h-8 w-8">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<span class="truncate">{name}</span>
					</button>
				{/each}
				{#if relations.friends.size === 0}
					<p class="px-2 py-4 text-xs text-sidebar-foreground/50">No friends yet</p>
				{/if}
			{:else if onRequests}
				{#each [...relations.incoming.entries()] as [did] (did)}
					{@const profile = resolveProfile(did, relations.instanceFor(did))}
					{@const name = displayName(profile, did)}
					<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70">
						<Avatar.Root class="h-8 w-8">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<span class="truncate">{name}</span>
					</div>
				{/each}
				{#if relations.incoming.size === 0}
					<p class="px-2 py-4 text-xs text-sidebar-foreground/50">No incoming requests</p>
				{/if}
			{:else if onIgnored}
				{#each [...relations.ignored] as did (did)}
					{@const profile = resolveProfile(did, relations.instanceFor(did))}
					{@const name = displayName(profile, did)}
					<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 opacity-70">
						<Avatar.Root class="h-8 w-8">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<span class="truncate">{name}</span>
					</div>
				{/each}
				{#if relations.ignored.size === 0}
					<p class="px-2 py-4 text-xs text-sidebar-foreground/50">No ignored users</p>
				{/if}
			{/if}
		</div>

		<Separator />
		<div class="p-2">
			<NavUser
				did={auth.identity?.did ?? ''}
				syrInstanceUrl={auth.identity?.syr_instance_url}
				handleSignOut={handleSignOut}
				toggleTheme={toggleMode}
			/>
		</div>
	</div>
{/snippet}

<div class="flex h-full min-w-0 flex-1 flex-col">
	{@render children?.()}
</div>
