<script lang="ts">
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { getServerState, upsertServer } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import ImageField from '$lib/components/image-field.svelte';

	const { serverId }: { serverId: string } = $props();

	const serverState = getServerState();
	const perms = getPerms();
	const server = $derived(serverState.activeServer);
	const canEdit = $derived(perms.canManageServer);

	let name = $state('');
	let description = $state('');
	let iconUrl = $state<string | null>(null);
	let bannerUrl = $state<string | null>(null);
	let inviteBgUrl = $state<string | null>(null);
	let saving = $state(false);

	// Seed state from the store when it becomes available
	$effect(() => {
		if (!server) return;
		name = server.name ?? '';
		description = server.description ?? '';
		iconUrl = server.icon_url ?? null;
		bannerUrl = server.banner_url ?? null;
		inviteBgUrl = server.invite_background_url ?? null;
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
			upsertServer({
				id: serverId,
				name: name.trim(),
				description: description.trim() || null,
				icon_url: iconUrl,
				banner_url: bannerUrl,
				invite_background_url: inviteBgUrl,
				owner_id: server?.owner_id ?? '',
				member_count: server?.member_count ?? 0
			});
			toast.success('Server updated');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update');
		}
		saving = false;
	}
</script>

<div class="space-y-4">
	<div class="space-y-2">
		<label for="srv-name" class="text-sm font-medium">Server Name</label>
		<Input id="srv-name" bind:value={name} disabled={!canEdit} />
	</div>
	<div class="space-y-2">
		<label for="srv-desc" class="text-sm font-medium">Description</label>
		<Input id="srv-desc" bind:value={description} placeholder="What's this server about?" disabled={!canEdit} />
	</div>
	<ImageField label="Icon" value={iconUrl} onChange={(v) => (iconUrl = v)} aspect="square" />
	<ImageField label="Banner" value={bannerUrl} onChange={(v) => (bannerUrl = v)} aspect="banner" />
	<ImageField
		label="Invite page background"
		value={inviteBgUrl}
		onChange={(v) => (inviteBgUrl = v)}
		aspect="wide"
	/>

	{#if canEdit}
		<div class="pt-2">
			<Button onclick={save} disabled={saving || !name.trim()}>
				{saving ? 'Saving…' : 'Save changes'}
			</Button>
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">You don't have permission to edit the server.</p>
	{/if}
</div>
