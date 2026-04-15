<script lang="ts">
	import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Lock, User } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { api } from '$lib/api';
	import { getRoles, type RoleData } from '$lib/stores/roles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import RoleEditDialog from '$lib/components/role-edit-dialog.svelte';

	const { serverId }: { serverId: string } = $props();

	const roleStore = getRoles();
	const memberStore = getMembers();
	const auth = getAuth();
	const perms = getPerms();
	const canManage = $derived(perms.canManageRoles);

	// Role IDs the current user holds in this server. Drives the "yours" badge.
	// @everyone is always held but we exclude it (it's already marked `default`).
	const myRoleIds = $derived.by(() => {
		const did = auth.identity?.did;
		if (!did) return new Set<string>();
		const me = memberStore.list.find((m) => m.user_id === did);
		return new Set((me?.role_ids ?? []).map((r) => (typeof r === 'string' ? r : (r as any)?.id ?? '')));
	});

	let editing = $state<RoleData | null>(null);
	let showCreate = $state(false);

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
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}

	async function move(role: RoleData, direction: 'up' | 'down') {
		const list = sortedRoles.filter((r) => !r.is_default);
		const idx = list.findIndex((r) => r.id === role.id);
		const swapWith = direction === 'up' ? list[idx - 1] : list[idx + 1];
		if (!swapWith) return;
		try {
			await api.roles.swap(role.id, swapWith.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<p class="text-xs text-muted-foreground">
			{sortedRoles.length} role{sortedRoles.length === 1 ? '' : 's'} · drag-free reorder via arrows
		</p>
		{#if canManage}
			<Button size="sm" onclick={() => (showCreate = true)}>
				<Plus class="mr-1.5 h-4 w-4" /> Create role
			</Button>
		{/if}
	</div>

	{#if sortedRoles.length === 0}
		<p class="rounded-md border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
			No roles yet.
		</p>
	{:else}
		<div class="space-y-1">
			{#each sortedRoles as role, i (role.id)}
				{@const manageable = perms.canManageRole(role)}
				{@const upTarget = sortedRoles.filter((r) => !r.is_default)[
					sortedRoles.filter((r) => !r.is_default).findIndex((r) => r.id === role.id) - 1
				]}
				{@const downTarget = sortedRoles.filter((r) => !r.is_default)[
					sortedRoles.filter((r) => !r.is_default).findIndex((r) => r.id === role.id) + 1
				]}
				{@const canMoveUp = manageable && !!upTarget && perms.canManageRole(upTarget)}
				{@const canMoveDown = manageable && !!downTarget}
				<div
					class="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 {manageable
						? ''
						: 'opacity-60'}"
				>
					<div class="flex items-center gap-2">
						<span
							class="inline-block h-3 w-3 rounded-full"
							style="background-color: {role.color || '#99aab5'}"
						></span>
						<span class="text-sm font-medium text-foreground">{role.name}</span>
						{#if role.is_default}
							<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">default</span>
						{/if}
						{#if !role.is_default && myRoleIds.has(role.id)}
							<span
								class="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
								title="You hold this role"
							>
								<User class="h-3 w-3" />
								yours
							</span>
						{/if}
						{#if !manageable && !role.is_default}
							{@const isMyTop = perms.isMyHighestRole(role)}
							<span
								class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
								title={isMyTop
									? 'This is your highest role — only roles strictly below it can be managed'
									: 'This role is above your highest role'}
							>
								<Lock class="h-3 w-3" />
								{isMyTop ? 'your highest role' : 'above your role'}
							</span>
						{/if}
					</div>
					{#if canManage}
						<div class="flex gap-1">
							{#if !role.is_default}
								<button
									onclick={() => move(role, 'up')}
									disabled={i === 0 || !canMoveUp}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
									title={canMoveUp ? 'Move up' : 'Cannot move above your highest role'}
								>
									<ChevronUp class="h-4 w-4" />
								</button>
								<button
									onclick={() => move(role, 'down')}
									disabled={i >= sortedRoles.length - 2 || !canMoveDown}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
									title="Move down"
								>
									<ChevronDown class="h-4 w-4" />
								</button>
							{/if}
							<button
								onclick={() => (editing = role)}
								disabled={!manageable && !role.is_default}
								class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
								title={manageable || role.is_default ? 'Edit' : 'Read-only — above your highest role'}
							>
								<Pencil class="h-4 w-4" />
							</button>
							{#if !role.is_default}
								<button
									onclick={() => deleteRole(role)}
									disabled={!manageable}
									class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
									title={manageable ? 'Delete' : 'Cannot delete role above your own'}
								>
									<Trash2 class="h-4 w-4" />
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

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
