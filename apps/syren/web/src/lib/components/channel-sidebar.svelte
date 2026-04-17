<script lang="ts">
	import { Hash, Volume2, ChevronDown, ChevronRight, Settings, UserPlus, Plus, MoreVertical, Pencil, Trash2, ScrollText, LogOut, FolderPlus, Shield } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { Separator } from '@syren/ui/separator';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import * as Dialog from '@syren/ui/dialog';
	import { getAuth } from '$lib/stores/auth.svelte';
	import NavUser from './nav-user.svelte';
	import VoiceControls from './voice-controls.svelte';
	import VoiceChannelUsers from './voice-channel-users.svelte';
	import CreateChannelDialog from './create-channel-dialog.svelte';
	import ChannelEditDialog from './channel-edit-dialog.svelte';
	import ChannelPermissionEditor from './channel-permission-editor.svelte';
	import { proxied } from '$lib/utils/proxy';
	import {
		getServerState,
		setServerChannels,
		setServerCategories,
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
	let showCreateChannel = $state(false);
	let editChannel = $state<{ id: string; name: string; topic: string } | null>(null);
	let showLeaveConfirm = $state(false);
	let leaving = $state(false);

	// Owners can't leave — they must delete the server. Gate the dropdown
	// item on owner status (live from the servers store).
	const isOwner = $derived(
		!!serverState.activeServerOwnerId && serverState.activeServerOwnerId === auth.identity?.did
	);

	async function leaveServer() {
		const sid = serverState.activeServerId;
		if (!sid || leaving) return;
		leaving = true;
		try {
			await api.servers.leave(sid);
			// Eager local cleanup — don't depend on the MEMBER_REMOVE WS round-
			// trip to update the rail. The self-MEMBER_REMOVE listener in
			// `servers.svelte.ts` would do the same thing, but WS delivery can
			// race with the navigation that follows. Clearing directly here
			// guarantees the rail is clean before `/channels/@me` mounts.
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

	// Group channels by category. Uncategorized channels have no category_id.
	const categories = $derived(serverState.categories);
	const uncategorized = $derived(
		serverState.channels.filter((c) => !c.category_id && c.type !== 'voice')
	);
	const voiceUncategorized = $derived(
		serverState.channels.filter((c) => !c.category_id && c.type === 'voice')
	);

	function channelsInCategory(catId: string) {
		return serverState.channels
			.filter((c) => String(c.category_id) === catId)
			.sort((a, b) => a.position - b.position);
	}

	// Collapsed categories (client-only, ephemeral)
	let collapsed = $state<Set<string>>(new Set());
	function toggleCollapse(catId: string) {
		const next = new Set(collapsed);
		if (next.has(catId)) next.delete(catId);
		else next.add(catId);
		collapsed = next;
	}

	let showCreateCategory = $state(false);
	let newCategoryName = $state('');
	let createChannelCategoryId = $state<string | undefined>(undefined);
	let permEditor = $state<{ scopeType: 'channel' | 'category'; scopeId: string; scopeName: string; channelType?: 'text' | 'voice' } | null>(null);

	async function refreshChannels() {
		if (!serverState.activeServerId) return;
		const [channels, cats] = await Promise.all([
			api.servers.channels(serverState.activeServerId),
			api.categories.list(serverState.activeServerId).catch(() => [])
		]);
		setServerChannels(channels as any[]);
		setServerCategories(cats as any[]);
	}

	async function handleCreateChannel(name: string, type: string) {
		if (!serverState.activeServerId) return;
		try {
			await api.servers.createChannel(serverState.activeServerId, {
				name,
				type,
				category_id: createChannelCategoryId
			});
			createChannelCategoryId = undefined;
			await refreshChannels();
		} catch {
			toast.error('Failed to create channel');
		}
	}

	async function createCategory() {
		if (!serverState.activeServerId || !newCategoryName.trim()) return;
		try {
			await api.categories.create(serverState.activeServerId, { name: newCategoryName.trim() });
			newCategoryName = '';
			showCreateCategory = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create category');
		}
	}

	async function deleteCategory(catId: string) {
		try {
			await api.categories.delete(catId);
			toast.success('Category deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	async function renameCategory(catId: string) {
		const newName = ''; // handled by inline editing
		// Placeholder for future inline rename
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

{#snippet channelRow(channel: { id: string; name?: string; type: string; topic?: string }, active: boolean)}
	<div class="group relative flex items-center">
		<a
			href="/channels/{encodeURIComponent(serverState.activeServerId ?? '')}/{encodeURIComponent(channel.id)}"
			class="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors
				{active
				? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
				: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
		>
			{#if channel.type === 'voice'}
				<Volume2 class="h-4 w-4 shrink-0 opacity-60" />
			{:else}
				<Hash class="h-4 w-4 shrink-0 opacity-60" />
			{/if}
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
						<DropdownMenu.Item onclick={() => (editChannel = { id: channel.id, name: channel.name ?? '', topic: channel.topic ?? '' })}>
							<Pencil class="mr-2 h-4 w-4" />
							Edit Channel
						</DropdownMenu.Item>
					{/if}
					{#if perms.canManageRoles}
						<DropdownMenu.Item onclick={() => (permEditor = { scopeType: 'channel', scopeId: channel.id, scopeName: channel.name ?? 'Channel', channelType: channel.type === 'voice' ? 'voice' : 'text' })}>
							<Shield class="mr-2 h-4 w-4" />
							Edit Permissions
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

	<!-- Channel list grouped by category -->
	<div class="flex-1 overflow-y-auto px-2 py-2">
		{#if perms.canManageChannels}
			<div class="mb-1 flex items-center justify-end gap-1 px-1">
				<button
					onclick={() => { createChannelCategoryId = undefined; showCreateChannel = true; }}
					class="rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
					title="Create Channel"
				>
					<Plus class="h-3.5 w-3.5" />
				</button>
				<button
					onclick={() => (showCreateCategory = true)}
					class="rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
					title="Create Category"
				>
					<FolderPlus class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}

		<!-- Uncategorized channels -->
		{#each uncategorized as channel (channel.id)}
			{@const active = page.params.channelId === channel.id}
			{@render channelRow(channel, active)}
		{/each}

		<!-- Categories -->
		{#each categories as cat (cat.id)}
			{@const catChannels = channelsInCategory(cat.id)}
			{@const isCollapsed = collapsed.has(cat.id)}
			<div class="mt-2">
				<div class="group mb-0.5 flex items-center justify-between px-1">
					<button
						type="button"
						onclick={() => toggleCollapse(cat.id)}
						class="flex items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50 hover:text-sidebar-foreground"
					>
						{#if isCollapsed}
							<ChevronRight class="h-3 w-3" />
						{:else}
							<ChevronDown class="h-3 w-3" />
						{/if}
						{cat.name}
					</button>
					{#if perms.canManageChannels}
						<div class="hidden items-center gap-0.5 group-hover:flex">
							<button
								onclick={() => { createChannelCategoryId = cat.id; showCreateChannel = true; }}
								class="rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
								title="Create channel in {cat.name}"
							>
								<Plus class="h-3 w-3" />
							</button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger class="rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground" title="Category options">
									<MoreVertical class="h-3 w-3" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content class="w-44">
									{#if perms.canManageRoles}
										<DropdownMenu.Item onclick={() => (permEditor = { scopeType: 'category', scopeId: cat.id, scopeName: cat.name })}>
											<Shield class="mr-2 h-4 w-4" />
											Edit Permissions
										</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Separator />
									<DropdownMenu.Item class="text-destructive" onclick={() => deleteCategory(cat.id)}>
										<Trash2 class="mr-2 h-4 w-4" />
										Delete Category
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/if}
				</div>
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

		<!-- Uncategorized voice channels -->
		{#if voiceUncategorized.length > 0}
			<div class="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
				Voice
			</div>
			{#each voiceUncategorized as channel (channel.id)}
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

{#if permEditor}
	<ChannelPermissionEditor
		open={true}
		serverId={serverState.activeServerId ?? ''}
		scopeType={permEditor.scopeType}
		scopeId={permEditor.scopeId}
		scopeName={permEditor.scopeName}
		channelType={permEditor.channelType}
		onClose={() => (permEditor = null)}
	/>
{/if}

<Dialog.Root open={showCreateCategory} onOpenChange={(v) => { if (!v) { showCreateCategory = false; newCategoryName = ''; } }}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Create Category</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); createCategory(); }} class="space-y-4 py-4">
			<Input
				bind:value={newCategoryName}
				placeholder="Category name"
				onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategory(); } }}
			/>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => { showCreateCategory = false; newCategoryName = ''; }}>Cancel</Button>
			<Button onclick={createCategory} disabled={!newCategoryName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
