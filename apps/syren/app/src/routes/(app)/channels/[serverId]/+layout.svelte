<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toggleMode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { WsOp } from '@syren/types';
	import { onWsEvent } from '$lib/stores/ws.svelte';
	import ChannelSidebar from '$lib/components/channel-sidebar.svelte';
	import InviteDialog from '$lib/components/invite-dialog.svelte';
	import ModerationSheet from '$lib/components/moderation-sheet.svelte';
	import { getModerationTarget, closeModeration } from '$lib/stores/moderation-target.svelte';
	import {
		getServerState,
		setActiveServer,
		setActiveServerOwner,
		setServerChannels,
		setServerCategories,
		upsertServer
	} from '$lib/stores/servers.svelte';
	import { setServerPerms, clearServerPerms } from '$lib/stores/perms.svelte';
	import { setRoles, clearRoles } from '$lib/stores/roles.svelte';
	import { setMembers, clearMembers, getMembers } from '$lib/stores/members.svelte';
	import { watchProfiles, unwatchProfiles } from '$lib/stores/profiles.svelte';
	import { setChannelUsers, clearChannelUsers } from '$lib/voice/voice-state.svelte';
	import { subscribeChannels, unsubscribeChannels } from '$lib/stores/ws.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { api } from '$lib/api';
	import { page } from '$app/state';

	let { children } = $props();
	const auth = getAuth();
	const serverId = $derived(page.params.serverId ?? '');

	const serverState = getServerState();
	const active = $derived(serverState.activeServer);
	const serverName = $derived(active?.name ?? 'Server');
	const serverDescription = $derived(active?.description ?? '');
	const serverOwnerId = $derived(active?.owner_id ?? '');
	const serverIconUrl = $derived(active?.icon_url ?? null);
	const serverBannerUrl = $derived(active?.banner_url ?? null);
	const serverInviteBgUrl = $derived(active?.invite_background_url ?? null);
	let showInvite = $state(false);
	let loadingServerId: string | null = null;
	// DIDs currently registered for federated hash watching — unregistered
	// when we switch servers so we don't grow the backend watchlist.
	let watchedDids: string[] = [];
	// WS topics (serverId + each channelId) we've subscribed to — so we can
	// unsubscribe when switching servers and not fan-out N servers of events.
	let subscribedTopics: string[] = [];

	const isOwner = $derived(serverOwnerId === auth.identity?.did);

	async function loadServer(id: string) {
		if (loadingServerId === id) return;
		loadingServerId = id;
		setActiveServer(id);
		clearServerPerms();
		clearRoles();
		clearMembers();

		// Unwatch previous server's member profiles
		if (watchedDids.length) {
			unwatchProfiles(watchedDids);
			watchedDids = [];
		}

		// Drop WS subscriptions for the previous server's topics so the gateway
		// stops fanning events for it. Otherwise every server we've visited
		// this session keeps delivering events, unbounded.
		if (subscribedTopics.length) {
			unsubscribeChannels(subscribedTopics);
			subscribedTopics = [];
		}

		// Clear stale voice-channel user lists from the previous server.
		clearChannelUsers();

		try {
			const [server, channels, categories, perms, roles, members] = await Promise.all([
				api.servers.get(id),
				api.servers.channels(id),
				api.categories.list(id).catch(() => []),
				api.roles
					.myPermissions(id)
					.catch(() => ({
						permissions: '0',
						permissions_allow: '0',
						permissions_deny: '0',
						highest_role_position: 0,
						is_owner: false
					})),
				api.roles.list(id).catch(() => []),
				api.servers.members(id).catch(() => [])
			]);
			// Bail if user switched server mid-fetch
			if (loadingServerId !== id) return;
			const s = server as any;
			upsertServer({
				id: String(s.id),
				name: s.name ?? 'Server',
				description: s.description ?? null,
				icon_url: s.icon_url ?? null,
				banner_url: s.banner_url ?? null,
				invite_background_url: s.invite_background_url ?? null,
				owner_id: s.owner_id ?? '',
				member_count: s.member_count ?? 0
			});
			setActiveServerOwner(s.owner_id || null);
			setServerChannels(channels as any[]);
			setServerCategories(categories as any[]);
			{
				const p = perms as {
					permissions: string;
					highest_role_position?: number;
					is_owner?: boolean;
				};
				setServerPerms(id, p.permissions || '0', {
					highest_role_position: p.highest_role_position ?? 0,
					is_owner: !!p.is_owner
				});
			}
			setRoles(id, roles as any[]);
			setMembers(id, members as any[]);

			const channelIds = (channels as any[]).map((c: any) => String(c.id));
			// Also subscribe to the server-level topic so we receive
			// CHANNEL_CREATE/UPDATE/DELETE / ROLE_* / MEMBER_* / voice state
			// broadcasts for the current server only.
			const topics = [id, ...channelIds];
			subscribeChannels(topics);
			subscribedTopics = topics;

			// Snapshot current voice-channel occupancy for every voice channel
			// in this server so user lists are populated immediately — the WS
			// broadcasts will keep them live from here on.
			try {
				const states = await api.servers.voiceStates(id);
				for (const [channelId, users] of Object.entries(states)) {
					setChannelUsers(channelId, users.map((u) => ({
						user_id: u.user_id,
						self_mute: u.self_mute,
						self_deaf: u.self_deaf,
						has_camera: u.has_camera ?? false,
						has_screen: u.has_screen ?? false
					})));
				}
			} catch { /* non-critical — WS will fill in as people join */ }

			// Register profile-hash watches for every member so we get
			// PROFILE_UPDATE events when their syr profile or stories change.
			const watchPayload = (members as any[])
				.filter((m) => !!m.syr_instance_url)
				.map((m) => ({ did: m.user_id as string, instance_url: m.syr_instance_url as string }));
			if (watchPayload.length) {
				watchProfiles(watchPayload);
				watchedDids = watchPayload.map((p) => p.did);
			}
		} catch (err) {
			if (loadingServerId !== id) return;
			setServerChannels([]);
			toast.error(err instanceof Error ? err.message : 'Failed to load server');
		}
	}

	$effect(() => {
		if (serverId) loadServer(serverId);
	});

	// Auto-subscribe to any channel created in this server during the session
	// so we keep getting per-channel events (MESSAGE_*, voice state, typing).
	const serverStateLocal = getServerState();
	$effect(() => {
		if (!subscribedTopics.length) return;
		const known = new Set(subscribedTopics);
		const missing = serverStateLocal.channels
			.map((c) => String(c.id))
			.filter((id) => !known.has(id));
		if (missing.length) {
			subscribeChannels(missing);
			subscribedTopics = [...subscribedTopics, ...missing];
		}
	});

	// Sync profile watches with member list — watch joins, unwatch leaves
	const memberStore = getMembers();
	$effect(() => {
		const activeDids = new Set(memberStore.list.map((m) => m.user_id));
		const currentDids = new Set(watchedDids);

		// Watch new members
		const newWatches = memberStore.list
			.filter((m) => !!m.syr_instance_url && !currentDids.has(m.user_id))
			.map((m) => ({ did: m.user_id, instance_url: m.syr_instance_url! }));
		if (newWatches.length > 0) {
			watchProfiles(newWatches);
		}

		// Unwatch removed members
		const removed = watchedDids.filter((did) => !activeDids.has(did));
		if (removed.length > 0) {
			unwatchProfiles(removed);
		}

		watchedDids = [...activeDids];
	});

	// Tear down subscriptions + profile watches when the user leaves this
	// server segment (nav to /settings, /channels/@me, signout, route unmount).
	// Without this, the old server's topics keep delivering events until a
	// different server's load fires.
	onDestroy(() => {
		if (subscribedTopics.length) {
			unsubscribeChannels(subscribedTopics);
			subscribedTopics = [];
		}
		if (watchedDids.length) {
			unwatchProfiles(watchedDids);
			watchedDids = [];
		}
	});

	// Refetch the channel list when permission overrides change — channels may
	// become visible or hidden, and per-channel my_permissions bitmasks shift.
	onWsEvent(WsOp.PERMISSION_OVERRIDE_UPDATE, async () => {
		const id = serverId;
		if (!id) return;
		try {
			const channels = await api.servers.channels(id);
			setServerChannels(channels as any[]);
			// Subscribe to any newly visible channels
			const known = new Set(subscribedTopics);
			const missing = (channels as any[])
				.map((c: any) => String(c.id))
				.filter((cid: string) => !known.has(cid));
			if (missing.length) {
				subscribeChannels(missing);
				subscribedTopics = [...subscribedTopics, ...missing];
			}
		} catch { /* best-effort */ }
	});

	onWsEvent(WsOp.SERVER_DELETE, (data) => {
		const { id } = data as { id?: string };
		if (id && String(id) === serverId) {
			toast.info('This server was deleted');
			goto('/channels/@me');
		}
	});

	// If the local user is removed (kicked / banned) from the server we're
	// currently viewing, bail out. Rail-level cleanup lives in the servers
	// store; this handler just ejects the view.
	onWsEvent(WsOp.MEMBER_REMOVE, (data) => {
		const { user_id, server_id } = data as { user_id?: string; server_id?: string };
		if (!user_id || !server_id) return;
		if (String(server_id) !== serverId) return;
		if (user_id !== auth.identity?.did) return;
		toast.info('You were removed from this server');
		goto('/channels/@me');
	});

	async function handleSignOut() {
		await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		window.location.href = '/login';
	}
</script>

<ChannelSidebar
	{serverName}
	bannerUrl={serverBannerUrl}
	userDid={auth.identity?.did ?? ''}
	userInstanceUrl={auth.identity?.syr_instance_url}
	onInvite={() => (showInvite = true)}
	onSettings={() => goto(`/channels/${encodeURIComponent(serverId)}/settings`)}
	handleSignOut={handleSignOut}
	toggleTheme={toggleMode}
/>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	{@render children?.()}
</div>

<InviteDialog
	open={showInvite}
	{serverId}
	onClose={() => (showInvite = false)}
/>

{#if getModerationTarget().value}
	{@const target = getModerationTarget().value!}
	<ModerationSheet
		{serverId}
		userId={target.did}
		instanceUrl={target.instance_url}
		onClose={closeModeration}
	/>
{/if}
