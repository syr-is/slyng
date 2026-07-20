<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Hash, Plus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import CreateChannelDialog from '@slyng/ui/fragments/create-channel-dialog.svelte';
	import { getServerState, setServerChannels } from '@slyng/app-core/stores/servers.svelte';
	import { getPerms } from '@slyng/app-core/stores/perms.svelte';
	import { api } from '@slyng/app-core/api';

	const serverId = $derived(page.params.serverId ?? '');
	const serverState = getServerState();
	const perms = getPerms();

	let showCreateChannel = $state(false);

	$effect(() => {
		if (!serverState.channelsLoaded) return;

		const firstText = serverState.channels.find((c) => c.type === 'text');
		if (firstText) {
			goto(`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(firstText.id)}`, {
				replaceState: true
			});
		}
	});

	// Same handler shape as the server-settings channels panel: create, then
	// refetch the sidebar list. The explicit goto covers voice channels — the
	// auto-redirect effect above only targets text channels (and for text the
	// freshly created channel IS the first text channel, so both paths agree).
	async function handleCreateChannel(name: string, type: string) {
		try {
			const created = await api.servers.createChannel(serverId, { name, type });
			const channels = await api.servers.channels(serverId);
			setServerChannels(channels);
			goto(`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(String(created.id))}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create channel');
		}
	}
</script>

{#if !serverState.channelsLoaded}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{:else if serverState.channels.length === 0}
	<div class="flex h-full flex-col items-center justify-center gap-3 p-8">
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
			<Hash class="h-6 w-6 text-muted-foreground" />
		</div>
		<p class="text-sm font-medium text-foreground">No channels yet</p>
		{#if perms.canManageChannels}
			<p class="text-xs text-muted-foreground">Create a channel to get started</p>
			<Button size="sm" class="mt-1" onclick={() => (showCreateChannel = true)}>
				<Plus class="mr-1.5 h-4 w-4" />
				Create channel
			</Button>
		{:else}
			<p class="text-xs text-muted-foreground">Ask a moderator to create one.</p>
		{/if}
	</div>
{:else}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-muted-foreground">Select a channel</p>
	</div>
{/if}

<CreateChannelDialog
	open={showCreateChannel}
	onClose={() => (showCreateChannel = false)}
	onCreate={handleCreateChannel}
/>
