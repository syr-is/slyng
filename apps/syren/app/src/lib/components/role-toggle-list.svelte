<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Check, Lock } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { getPerms } from '$lib/stores/perms.svelte';

	/**
	 * Inline list of togglable roles for a member. Used by the popover in
	 * member lists AND directly inside the moderation sheet — hence extracted
	 * from `MemberRolesPopover` so both surfaces render identical chips.
	 */
	const {
		serverId,
		userId,
		assigned,
		allRoles
	}: {
		serverId: string;
		userId: string;
		assigned: { id: string }[];
		allRoles: {
			id: string;
			name: string;
			color: string | null;
			position?: number;
			is_default?: boolean;
		}[];
	} = $props();

	const perms = getPerms();
	const assignedSet = $derived(new Set(assigned.map((r) => r.id)));
	const assignable = $derived(allRoles.filter((r) => !r.is_default));

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

{#if assignable.length === 0}
	<p class="px-1 py-1 text-xs text-muted-foreground">No custom roles yet</p>
{:else}
	<div class="flex flex-col gap-0.5">
		{#each assignable as role (role.id)}
			{@const isAssigned = assignedSet.has(role.id)}
			{@const canAssign = perms.canAssignRole(role)}
			<button
				type="button"
				onclick={() => canAssign && toggle(role.id, isAssigned)}
				disabled={!canAssign}
				title={canAssign ? '' : 'This role is at or above your highest role'}
				class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
			>
				<span
					class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border
						{isAssigned ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}"
				>
					{#if isAssigned}
						<Check class="h-3 w-3" />
					{/if}
				</span>
				<span
					class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
					style="background-color: {role.color || '#99aab5'}"
				></span>
				<span class="truncate">{role.name}</span>
				{#if !canAssign}
					<Lock class="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
				{/if}
			</button>
		{/each}
	</div>
{/if}
