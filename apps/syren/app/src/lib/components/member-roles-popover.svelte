<script lang="ts">
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { Shield } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';

	const {
		serverId,
		userId,
		assigned,
		allRoles
	}: {
		serverId: string;
		userId: string;
		assigned: { id: string }[];
		allRoles: { id: string; name: string; color: string | null; is_default?: boolean }[];
	} = $props();

	const assignedSet = $derived(new Set(assigned.map((r) => r.id)));

	async function toggle(roleId: string, isAssigned: boolean) {
		try {
			if (isAssigned) {
				await api.roles.unassign(serverId, userId, roleId);
			} else {
				await api.roles.assign(serverId, userId, roleId);
			}
			// WS MEMBER_UPDATE handler updates the store automatically
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="rounded p-1 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
		title="Manage roles"
	>
		<Shield class="h-3.5 w-3.5" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-56" align="end">
		<DropdownMenu.Label>Roles</DropdownMenu.Label>
		<DropdownMenu.Separator />
		{#each allRoles.filter((r) => !r.is_default) as role}
			{@const isAssigned = assignedSet.has(role.id)}
			<DropdownMenu.Item onclick={() => toggle(role.id, isAssigned)}>
				<input
					type="checkbox"
					checked={isAssigned}
					readonly
					tabindex={-1}
					class="mr-2 h-3.5 w-3.5 pointer-events-none"
				/>
				<span
					class="inline-block h-2.5 w-2.5 rounded-full mr-2"
					style="background-color: {role.color || '#99aab5'}"
				></span>
				<span>{role.name}</span>
			</DropdownMenu.Item>
		{/each}
		{#if allRoles.filter((r) => !r.is_default).length === 0}
			<div class="px-2 py-1.5 text-xs text-muted-foreground">No custom roles yet</div>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
