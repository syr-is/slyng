<script lang="ts">
	import { Hash, Volume2, ChevronDown, Settings, UserPlus, Plus, MoreVertical, Pencil, Trash2, ScrollText } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { Separator } from '@syren/ui/separator';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import NavUser from './nav-user.svelte';
	import VoiceControls from './voice-controls.svelte';
	import VoiceChannelUsers from './voice-channel-users.svelte';
	import CreateChannelDialog from './create-channel-dialog.svelte';
	import ChannelEditDialog from './channel-edit-dialog.svelte';
	import { proxied } from '$lib/utils/proxy';
	import { getServerState, setServerChannels } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
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
	let showCreateChannel = $state(false);
	let editChannel = $state<{ id: string; name: string; topic: string } | null>(null);

	const textChannels = $derived(serverState.channels.filter((c) => c.type === 'text'));
	const voiceChannels = $derived(serverState.channels.filter((c) => c.type === 'voice'));

	async function refreshChannels() {
		if (!serverState.activeServerId) return;
		const channels = await api.servers.channels(serverState.activeServerId);
		setServerChannels(channels as any[]);
	}

	async function handleCreateChannel(name: string, type: string) {
		if (!serverState.activeServerId) return;
		try {
			await api.servers.createChannel(serverState.activeServerId, { name, type });
			await refreshChannels();
		} catch {
			toast.error('Failed to create channel');
		}
	}

	async function deleteChannel(channelId: string) {
		try {
			await api.channels.delete(channelId);
			await refreshChannels();
			toast.success('Channel deleted');
			// If the deleted channel was active, navigate to server root
			if (page.url.pathname.includes(channelId) && serverState.activeServerId) {
				goto(`/channels/${encodeURIComponent(serverState.activeServerId)}`, { replaceState: true });
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}
</script>

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
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<!-- Channel list -->
	<div class="flex-1 overflow-y-auto px-2 py-2">
		<!-- Text channels -->
		<div class="mb-1 flex items-center justify-between px-1">
			<span class="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
				Text Channels
			</span>
			{#if perms.canManageChannels}
				<button
					onclick={() => (showCreateChannel = true)}
					class="rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
					title="Create Channel"
				>
					<Plus class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>
		{#each textChannels as channel}
			{@const active = page.params.channelId === channel.id}
			<div class="group relative flex items-center">
				<a
					href="/channels/{encodeURIComponent(serverState.activeServerId ?? '')}/{encodeURIComponent(channel.id)}"
					class="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors
						{active
						? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
				>
					<Hash class="h-4 w-4 shrink-0 opacity-60" />
					<span class="truncate">{channel.name}</span>
				</a>
				{#if perms.canManageChannels || perms.canViewAuditLog}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="absolute right-1 hidden h-6 w-6 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:flex data-[state=open]:flex"
							title="Channel options"
						>
							<MoreVertical class="h-4 w-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-44">
							{#if perms.canManageChannels}
								<DropdownMenu.Item onclick={() => (editChannel = { id: channel.id, name: channel.name ?? '', topic: (channel as any).topic ?? '' })}>
									<Pencil class="mr-2 h-4 w-4" />
									Edit Channel
								</DropdownMenu.Item>
							{/if}
							{#if perms.canViewAuditLog}
								<DropdownMenu.Item
									onclick={() =>
										goto(
											`/channels/${encodeURIComponent(serverState.activeServerId ?? '')}/audit-log?channel_id=${encodeURIComponent(channel.id)}`
										)}
								>
									<ScrollText class="mr-2 h-4 w-4" />
									Audit Log
								</DropdownMenu.Item>
							{/if}
							{#if perms.canManageChannels}
								<DropdownMenu.Separator />
								<DropdownMenu.Item class="text-destructive" onclick={() => deleteChannel(channel.id)}>
									<Trash2 class="mr-2 h-4 w-4" />
									Delete Channel
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}
			</div>
		{/each}

		{#if textChannels.length === 0}
			<p class="px-2 py-2 text-xs text-sidebar-foreground/40">No text channels</p>
		{/if}

		<!-- Voice channels -->
		{#if voiceChannels.length > 0}
			<div class="mb-1 mt-4 px-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
				Voice Channels
			</div>
			{#each voiceChannels as channel}
				{@const active = page.params.channelId === channel.id}
				<a
					href="/channels/{encodeURIComponent(serverState.activeServerId ?? '')}/{encodeURIComponent(channel.id)}"
					class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors
						{active
						? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
						: voice.channelId === channel.id
							? 'bg-sidebar-accent/60 text-sidebar-accent-foreground'
							: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
				>
					<Volume2 class="h-4 w-4 shrink-0 opacity-60" />
					<span class="truncate">{channel.name}</span>
				</a>
				<VoiceChannelUsers channelId={channel.id} />
			{/each}
		{/if}
	</div>

	<VoiceControls />

	<Separator />
	<div class="p-2">
		<NavUser did={userDid} syrInstanceUrl={userInstanceUrl} {handleSignOut} {toggleTheme} />
	</div>
</div>

<CreateChannelDialog
	open={showCreateChannel}
	onClose={() => (showCreateChannel = false)}
	onCreate={handleCreateChannel}
/>

{#if editChannel}
	<ChannelEditDialog
		open={true}
		channelId={editChannel.id}
		channelName={editChannel.name}
		channelTopic={editChannel.topic}
		onClose={() => (editChannel = null)}
		onUpdated={refreshChannels}
	/>
{/if}
