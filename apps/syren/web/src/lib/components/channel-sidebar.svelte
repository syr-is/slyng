<script lang="ts">
	import { Hash, Volume2, ChevronDown, ChevronRight, Settings, UserPlus, MoreVertical, ScrollText, LogOut } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { Separator } from '@syren/ui/separator';
	import { Button } from '@syren/ui/button';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import * as Dialog from '@syren/ui/dialog';
	import { getAuth } from '$lib/stores/auth.svelte';
	import NavUser from './nav-user.svelte';
	import VoiceControls from './voice-controls.svelte';
	import VoiceChannelUsers from './voice-channel-users.svelte';
	import { proxied } from '$lib/utils/proxy';
	import {
		getServerState,
		setServerChannels,
		removeServer,
		setActiveServer
	} from '$lib/stores/servers.svelte';
	import { getPerms, clearServerPerms } from '$lib/stores/perms.svelte';
	import { clearMembers } from '$lib/stores/members.svelte';
	import { clearRoles } from '$lib/stores/roles.svelte';
	import { getVoiceState } from '$lib/voice/voice-state.svelte';
	import { api } from '$lib/api';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';

	const {
		serverName,
		bannerUrl = null,
		userDid,
		userInstanceUrl,
		onInvite,
		onSettings,
		handleSignOut,
		toggleTheme
	}: {
		serverName: string;
		bannerUrl?: string | null;
		userDid: string;
		userInstanceUrl?: string;
		onInvite: () => void;
		onSettings: () => void;
		handleSignOut: () => void | Promise<void>;
		toggleTheme: () => void;
	} = $props();

	const serverState = getServerState();
	const perms = getPerms();
	const voice = getVoiceState();
	const auth = getAuth();
	let showLeaveConfirm = $state(false);
	let leaving = $state(false);

	const isOwner = $derived(
		!!serverState.activeServerOwnerId && serverState.activeServerOwnerId === auth.identity?.did
	);

	async function leaveServer() {
		const sid = serverState.activeServerId;
		if (!sid || leaving) return;
		leaving = true;
		try {
			await api.servers.leave(sid);
			removeServer(sid);
			setActiveServer(null);
			setServerChannels([]);
			clearMembers();
			clearRoles();
			clearServerPerms();
			toast.success(`Left ${serverName}`);
			showLeaveConfirm = false;
			goto('/channels/@me');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to leave');
		}
		leaving = false;
	}

	const categories = $derived(serverState.categories);
	const uncategorized = $derived(
		serverState.channels.filter((c) => !c.category_id).sort((a, b) => a.position - b.position)
	);

	function channelsInCategory(catId: string) {
		return serverState.channels
			.filter((c) => String(c.category_id) === catId)
			.sort((a, b) => a.position - b.position);
	}

	let collapsed = $state<Set<string>>(new Set());
	function toggleCollapse(catId: string) {
		const next = new Set(collapsed);
		if (next.has(catId)) next.delete(catId);
		else next.add(catId);
		collapsed = next;
	}
</script>

{#snippet channelRow(channel: { id: string; name?: string; type: string; topic?: string }, active: boolean)}
	<div class="group relative flex items-center">
		<a
			href="/channels/{encodeURIComponent(serverState.activeServerId ?? '')}/{encodeURIComponent(channel.id)}"
			class="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors
				{active
				? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
				: channel.type === 'voice' && voice.channelId === channel.id
					? 'bg-sidebar-accent/60 text-sidebar-accent-foreground'
					: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
		>
			{#if channel.type === 'voice'}
				<Volume2 class="h-4 w-4 shrink-0 opacity-60" />
			{:else}
				<Hash class="h-4 w-4 shrink-0 opacity-60" />
			{/if}
			<span class="truncate">{channel.name}</span>
		</a>
		{#if perms.canViewAuditLog}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="absolute right-1 hidden h-6 w-6 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:flex data-[state=open]:flex"
					title="Channel options"
				>
					<MoreVertical class="h-4 w-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-44">
					<DropdownMenu.Item
						onclick={() =>
							goto(
								`/channels/${encodeURIComponent(serverState.activeServerId ?? '')}/audit-log?channel_id=${encodeURIComponent(channel.id)}`
							)}
					>
						<ScrollText class="mr-2 h-4 w-4" />
						Audit Log
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
	{#if channel.type === 'voice'}
		<VoiceChannelUsers channelId={channel.id} />
	{/if}
{/snippet}

<div class="flex h-full w-60 flex-col border-r border-border bg-sidebar">
	<!-- Server header -->
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="relative flex h-12 w-full items-center justify-between overflow-hidden border-b border-sidebar-border px-4 hover:bg-sidebar-accent"
		>
			{#if bannerUrl}
				<img
					src={proxied(bannerUrl)}
					alt=""
					aria-hidden="true"
					class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
				/>
				<div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-sidebar/80 via-sidebar/40 to-transparent"></div>
			{/if}
			<span class="relative truncate text-sm font-semibold text-sidebar-foreground drop-shadow-sm">{serverName}</span>
			<ChevronDown class="relative h-4 w-4 shrink-0 text-sidebar-foreground/60" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-56">
			{#if perms.canCreateInvites}
				<DropdownMenu.Item onclick={onInvite}>
					<UserPlus class="mr-2 h-4 w-4" />
					Invite People
				</DropdownMenu.Item>
			{/if}
			{#if perms.canCreateInvites && perms.canManageServer}
				<DropdownMenu.Separator />
			{/if}
			{#if perms.canManageServer}
				<DropdownMenu.Item onclick={onSettings}>
					<Settings class="mr-2 h-4 w-4" />
					Server Settings
				</DropdownMenu.Item>
			{/if}
			{#if perms.canViewAuditLog}
				{#if perms.canCreateInvites || perms.canManageServer}
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Item
					onclick={() =>
						goto(
							`/channels/${encodeURIComponent(serverState.activeServerId ?? '')}/audit-log`
						)}
				>
					<ScrollText class="mr-2 h-4 w-4" />
					Audit Log
				</DropdownMenu.Item>
			{/if}
			{#if !isOwner}
				{#if perms.canCreateInvites || perms.canManageServer || perms.canViewAuditLog}
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Item
					class="text-destructive focus:text-destructive"
					onclick={() => (showLeaveConfirm = true)}
				>
					<LogOut class="mr-2 h-4 w-4" />
					Leave Server
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<!-- Channel list -->
	<div class="flex-1 overflow-y-auto px-2 py-2">
		<!-- Uncategorized channels (text + voice) -->
		{#each uncategorized as channel (channel.id)}
			{@const active = page.params.channelId === channel.id}
			{@render channelRow(channel, active)}
		{/each}

		<!-- Categories -->
		{#each categories as cat (cat.id)}
			{@const catChannels = channelsInCategory(cat.id)}
			{@const isCollapsed = collapsed.has(cat.id)}
			<div class="mt-2">
				<button
					type="button"
					onclick={() => toggleCollapse(cat.id)}
					class="mb-0.5 flex items-center gap-0.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50 hover:text-sidebar-foreground"
				>
					{#if isCollapsed}
						<ChevronRight class="h-3 w-3" />
					{:else}
						<ChevronDown class="h-3 w-3" />
					{/if}
					{cat.name}
				</button>
				{#if !isCollapsed}
					{#each catChannels as channel (channel.id)}
						{@const active = page.params.channelId === channel.id}
						{@render channelRow(channel, active)}
					{/each}
					{#if catChannels.length === 0}
						<p class="px-2 py-1 text-[11px] text-sidebar-foreground/30">Empty</p>
					{/if}
				{/if}
			</div>
		{/each}
	</div>

	<VoiceControls />

	<Separator />
	<div class="p-2">
		<NavUser did={userDid} syrInstanceUrl={userInstanceUrl} {handleSignOut} {toggleTheme} />
	</div>
</div>

<Dialog.Root open={showLeaveConfirm} onOpenChange={(v) => { if (!v && !leaving) showLeaveConfirm = false; }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<LogOut class="h-5 w-5" />
				Leave {serverName}?
			</Dialog.Title>
			<Dialog.Description>
				You'll stop receiving messages and need a new invite to rejoin. Your messages stay.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" disabled={leaving} onclick={() => (showLeaveConfirm = false)}>
				Cancel
			</Button>
			<Button variant="destructive" disabled={leaving} onclick={leaveServer}>
				{leaving ? 'Leaving…' : 'Leave server'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
