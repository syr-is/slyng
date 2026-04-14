<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Separator } from '@syren/ui/separator';
	import { Shield, Users } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { setServers } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import RolesDialog from './roles-dialog.svelte';
	import MembersDialog from './members-dialog.svelte';
	import ImageField from './image-field.svelte';

	const {
		open,
		serverId,
		serverName: initialName,
		serverDescription: initialDesc,
		serverIconUrl: initialIcon,
		serverBannerUrl: initialBanner,
		serverInviteBackgroundUrl: initialInviteBg,
		isOwner,
		onClose,
		onUpdated
	}: {
		open: boolean;
		serverId: string;
		serverName: string;
		serverDescription: string;
		serverIconUrl?: string | null;
		serverBannerUrl?: string | null;
		serverInviteBackgroundUrl?: string | null;
		isOwner: boolean;
		onClose: () => void;
		onUpdated: (server: {
			name: string;
			description?: string;
			icon_url?: string | null;
			banner_url?: string | null;
			invite_background_url?: string | null;
		}) => void;
	} = $props();

	const perms = getPerms();
	let name = $state(initialName);
	let description = $state(initialDesc || '');
	let iconUrl = $state<string | null>(initialIcon ?? null);
	let bannerUrl = $state<string | null>(initialBanner ?? null);
	let inviteBgUrl = $state<string | null>(initialInviteBg ?? null);
	let saving = $state(false);
	let deleting = $state(false);
	let showDeleteConfirm = $state(false);
	let showRoles = $state(false);
	let showMembers = $state(false);

	$effect(() => {
		if (open) {
			name = initialName;
			description = initialDesc || '';
			iconUrl = initialIcon ?? null;
			bannerUrl = initialBanner ?? null;
			inviteBgUrl = initialInviteBg ?? null;
			showDeleteConfirm = false;
		}
	});

	async function save() {
		if (!name.trim()) return;
		saving = true;
		try {
			await api.servers.update(serverId, {
				name: name.trim(),
				description: description.trim() || undefined,
				icon_url: iconUrl,
				banner_url: bannerUrl,
				invite_background_url: inviteBgUrl
			});
			onUpdated({
				name: name.trim(),
				description: description.trim() || undefined,
				icon_url: iconUrl,
				banner_url: bannerUrl,
				invite_background_url: inviteBgUrl
			});
			toast.success('Server updated');
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update');
		}
		saving = false;
	}

	async function deleteServer() {
		deleting = true;
		try {
			await api.servers.delete(serverId);
			const servers = await api.servers.list();
			setServers(servers as any[]);
			toast.success('Server deleted');
			onClose();
			goto('/channels/@me');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
		deleting = false;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Server Settings</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="srv-name" class="text-sm font-medium">Server Name</label>
				<Input id="srv-name" bind:value={name} />
			</div>
			<div class="space-y-2">
				<label for="srv-desc" class="text-sm font-medium">Description</label>
				<Input id="srv-desc" bind:value={description} placeholder="What's this server about?" />
			</div>
			<ImageField label="Icon" value={iconUrl} onChange={(v) => (iconUrl = v)} aspect="square" />
			<ImageField label="Banner" value={bannerUrl} onChange={(v) => (bannerUrl = v)} aspect="banner" />
			<ImageField
				label="Invite page background"
				value={inviteBgUrl}
				onChange={(v) => (inviteBgUrl = v)}
				aspect="wide"
			/>
		</div>

		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button onclick={save} disabled={saving || !name.trim()}>
				{saving ? 'Saving...' : 'Save'}
			</Button>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
		</Dialog.Footer>

		{#if perms.canManageRoles || perms.canKick}
			<Separator class="my-4" />
			<div class="space-y-2">
				{#if perms.canManageRoles}
					<Button variant="outline" class="w-full justify-start" onclick={() => (showRoles = true)}>
						<Shield class="mr-2 h-4 w-4" />
						Manage Roles
					</Button>
				{/if}
				<Button variant="outline" class="w-full justify-start" onclick={() => (showMembers = true)}>
					<Users class="mr-2 h-4 w-4" />
					Manage Members
				</Button>
			</div>
		{/if}

		{#if isOwner}
			<Separator class="my-4" />
			<div class="space-y-2">
				{#if showDeleteConfirm}
					<p class="text-sm text-destructive">Are you sure? This will permanently delete the server, all channels, and all messages.</p>
					<div class="flex gap-2">
						<Button variant="destructive" onclick={deleteServer} disabled={deleting}>
							{deleting ? 'Deleting...' : 'Yes, Delete Server'}
						</Button>
						<Button variant="outline" onclick={() => (showDeleteConfirm = false)}>Cancel</Button>
					</div>
				{:else}
					<Button variant="outline" class="text-destructive" onclick={() => (showDeleteConfirm = true)}>
						Delete Server
					</Button>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if showRoles}
	<RolesDialog open={true} {serverId} onClose={() => (showRoles = false)} />
{/if}

{#if showMembers}
	<MembersDialog open={true} {serverId} onClose={() => (showMembers = false)} />
{/if}
