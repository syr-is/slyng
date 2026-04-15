<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { Button } from '@syren/ui/button';
	import { Separator } from '@syren/ui/separator';
	import { api } from '$lib/api';
	import { setServers } from '$lib/stores/servers.svelte';

	const { serverId }: { serverId: string } = $props();

	let confirming = $state(false);
	let deleting = $state(false);

	async function deleteServer() {
		deleting = true;
		try {
			await api.servers.delete(serverId);
			const servers = await api.servers.list();
			setServers(servers as any[]);
			toast.success('Server deleted');
			goto('/channels/@me');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
		deleting = false;
	}
</script>

<div class="space-y-4">
	<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
		<h3 class="text-sm font-semibold text-destructive">Delete server</h3>
		<p class="mt-1 text-xs text-muted-foreground">
			This permanently removes the server, all channels, messages, members, roles, and invites. Cannot be undone.
		</p>
		<Separator class="my-3" />
		{#if confirming}
			<p class="mb-3 text-sm text-destructive">Are you sure? This cannot be undone.</p>
			<div class="flex gap-2">
				<Button variant="destructive" disabled={deleting} onclick={deleteServer}>
					{deleting ? 'Deleting…' : 'Yes, delete server'}
				</Button>
				<Button variant="outline" onclick={() => (confirming = false)}>Cancel</Button>
			</div>
		{:else}
			<Button variant="destructive" onclick={() => (confirming = true)}>Delete server</Button>
		{/if}
	</div>
</div>
