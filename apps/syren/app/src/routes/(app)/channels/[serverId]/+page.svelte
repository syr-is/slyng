<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Hash } from '@lucide/svelte';
	import { getServerState } from '$lib/stores/servers.svelte';

	const serverId = $derived(page.params.serverId ?? '');
	const state = getServerState();

	$effect(() => {
		if (!state.channelsLoaded) return;

		const firstText = state.channels.find((c) => c.type === 'text');
		if (firstText) {
			goto(`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(firstText.id)}`, { replaceState: true });
		}
	});
</script>

{#if !state.channelsLoaded}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{:else if state.channels.length === 0}
	<div class="flex h-full flex-col items-center justify-center gap-3 p-8">
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
			<Hash class="h-6 w-6 text-muted-foreground" />
		</div>
		<p class="text-sm font-medium text-foreground">No channels yet</p>
		<p class="text-xs text-muted-foreground">Create a channel to get started</p>
	</div>
{:else}
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-muted-foreground">Select a channel</p>
	</div>
{/if}
