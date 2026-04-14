<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { getRoles, type RoleData } from '$lib/stores/roles.svelte';
	import RoleEditDialog from './role-edit-dialog.svelte';

	const {
		open,
		serverId,
		onClose
	}: {
		open: boolean;
		serverId: string;
		onClose: () => void;
	} = $props();

	const roleStore = getRoles();
	let editing = $state<RoleData | null>(null);
	let showCreate = $state(false);

	// Sorted by position desc (highest first), default role pinned to bottom
	const sortedRoles = $derived(
		[...roleStore.list].sort((a, b) => {
			if (a.is_default) return 1;
			if (b.is_default) return -1;
			return b.position - a.position;
		})
	);

	async function deleteRole(role: RoleData) {
		try {
			await api.roles.delete(role.id);
			toast.success('Role deleted');
			// WS ROLE_DELETE handler updates the store
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}

	async function move(role: RoleData, direction: 'up' | 'down') {
		// Up means higher position (more important). Find adjacent non-default role.
		const list = sortedRoles.filter((r) => !r.is_default);
		const idx = list.findIndex((r) => r.id === role.id);
		const swapWith = direction === 'up' ? list[idx - 1] : list[idx + 1];
		if (!swapWith) return;
		try {
			await api.roles.swap(role.id, swapWith.id);
			// WS ROLE_UPDATE handlers update the store
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Roles</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-2 py-4">
			{#if sortedRoles.length === 0}
				<p class="text-sm text-muted-foreground">No roles yet.</p>
			{:else}
				{#each sortedRoles as role, i (role.id)}
					<div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
						<div class="flex items-center gap-2">
							<span
								class="inline-block h-3 w-3 rounded-full"
								style="background-color: {role.color || '#99aab5'}"
							></span>
							<span class="text-sm font-medium text-foreground">{role.name}</span>
							{#if role.is_default}
								<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">default</span>
							{/if}
						</div>
						<div class="flex gap-1">
							{#if !role.is_default}
								<button
									onclick={() => move(role, 'up')}
									disabled={i === 0}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
									title="Move up"
								>
									<ChevronUp class="h-4 w-4" />
								</button>
								<button
									onclick={() => move(role, 'down')}
									disabled={i >= sortedRoles.length - 2}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
									title="Move down"
								>
									<ChevronDown class="h-4 w-4" />
								</button>
							{/if}
							<button
								onclick={() => (editing = role)}
								class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
								title="Edit"
							>
								<Pencil class="h-4 w-4" />
							</button>
							{#if !role.is_default}
								<button
									onclick={() => deleteRole(role)}
									class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button onclick={() => (showCreate = true)}>
				<Plus class="mr-2 h-4 w-4" />
				Create Role
			</Button>
			<Button variant="outline" onclick={onClose}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if editing}
	<RoleEditDialog
		open={true}
		{serverId}
		role={editing}
		onClose={() => (editing = null)}
		onSaved={() => {}}
	/>
{/if}

{#if showCreate}
	<RoleEditDialog
		open={true}
		{serverId}
		role={null}
		onClose={() => (showCreate = false)}
		onSaved={() => {}}
	/>
{/if}
