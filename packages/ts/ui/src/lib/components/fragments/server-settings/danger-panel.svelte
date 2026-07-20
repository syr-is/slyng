<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import * as Dialog from '@slyng/ui/dialog';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { Separator } from '@slyng/ui/separator';
	import { AlertTriangle } from '@lucide/svelte';
	import { api } from '@slyng/app-core/api';
	import { getServerState, setServers } from '@slyng/app-core/stores/servers.svelte';
	import { getMembers } from '@slyng/app-core/stores/members.svelte';
	import { getRoles } from '@slyng/app-core/stores/roles.svelte';
	import TransferOwnershipDialog from './transfer-ownership-dialog.svelte';

	const { serverId }: { serverId: string } = $props();

	const serverState = getServerState();
	const memberStore = getMembers();
	const roleStore = getRoles();
	const serverName = $derived(serverState.activeServer?.name ?? 'this server');

	// Blast-radius counts from loaded store state — the confirm must force
	// acknowledgment of exactly what is destroyed.
	const channelCount = $derived(serverState.channels.length);
	const memberCount = $derived(memberStore.list.length);
	const roleCount = $derived(roleStore.list.length);
	const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

	// Type-to-confirm: deleting the whole server carries at least as much
	// friction as hard-deleting a single channel or role.
	let showDeleteDialog = $state(false);
	let typed = $state('');
	let deleting = $state(false);
	let showTransfer = $state(false);
	const nameMatches = $derived(typed.trim() === serverName.trim());

	function openDeleteDialog() {
		typed = '';
		deleting = false;
		showDeleteDialog = true;
	}

	async function deleteServer() {
		if (!nameMatches || deleting) return;
		deleting = true;
		try {
			await api.servers.delete(serverId);
			const servers = await api.servers.list();
			setServers(servers as any[]);
			toast.success('Server deleted');
			showDeleteDialog = false;
			goto('/channels/@me');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
		deleting = false;
	}
</script>

<div class="space-y-4">
	<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
		<h3 class="text-sm font-semibold">Transfer ownership</h3>
		<p class="mt-1 text-xs text-muted-foreground">
			Hand the server to another member. You'll keep a new "Former Owner" role with admin
			permissions at the top of the hierarchy. Action is immediate.
		</p>
		<Separator class="my-3" />
		<Button variant="outline" onclick={() => (showTransfer = true)}>
			Transfer ownership…
		</Button>
	</div>

	<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
		<h3 class="text-sm font-semibold text-destructive">Delete server</h3>
		<p class="mt-1 text-xs text-muted-foreground">
			This permanently removes the server, all channels, messages, members, roles, and invites. Cannot be undone.
		</p>
		<Separator class="my-3" />
		<Button variant="destructive" onclick={openDeleteDialog}>Delete server…</Button>
	</div>
</div>

<!-- bits-ui closes internally on Escape/outside-click before we can veto, so
     bind the open state and flip it back when a dismissal lands mid-delete —
     otherwise the wrapper's local copy desyncs from showDeleteDialog. -->
<Dialog.Root bind:open={showDeleteDialog} onOpenChange={(v) => { if (!v && deleting) showDeleteDialog = true; }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<AlertTriangle class="h-5 w-5 shrink-0" />
				<span class="min-w-0 truncate">Permanently delete "{serverName}"?</span>
			</Dialog.Title>
			<Dialog.Description>
				This erases {n(channelCount, 'channel')} and every message in them, {n(roleCount, 'role')},
				the membership history of {n(memberCount, 'member')}, and all invites. There is no undo.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2 py-2">
			<label for="server-delete-confirm" class="text-xs text-muted-foreground">
				Type <span class="font-mono text-foreground">{serverName}</span> to confirm
			</label>
			<Input id="server-delete-confirm" bind:value={typed} placeholder={serverName} autocomplete="off" />
		</div>

		<Dialog.Footer>
			<Button variant="outline" disabled={deleting} onclick={() => (showDeleteDialog = false)}>Cancel</Button>
			<Button variant="destructive" disabled={!nameMatches || deleting} onclick={deleteServer}>
				{deleting ? 'Deleting…' : 'Delete forever'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if showTransfer}
	<TransferOwnershipDialog
		open={true}
		{serverId}
		{serverName}
		onClose={() => (showTransfer = false)}
	/>
{/if}
