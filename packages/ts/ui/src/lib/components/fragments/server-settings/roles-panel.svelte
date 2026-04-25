<script lang="ts">
	import { Plus, Pencil, Trash2, GripVertical, Lock, User } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { api } from '@syren/app-core/api';
	import { getRoles, setRoles, reorderRoles, type RoleData } from '@syren/app-core/stores/roles.svelte';
	import { getMembers } from '@syren/app-core/stores/members.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import RoleEditDialog from '../role-edit-dialog.svelte';

	const { serverId }: { serverId: string } = $props();

	const roleStore = getRoles();
	const memberStore = getMembers();
	const auth = getAuth();
	const perms = getPerms();
	const canManage = $derived(perms.canManageRoles);

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

	// ── Drag-and-drop ──

	let draggedId = $state<string | null>(null);
	let dropTargetId = $state<string | null>(null);
	let dropSide = $state<'above' | 'below'>('above');

	const manageableIds = $derived(
		new Set(sortedRoles.filter((r) => !r.is_default && perms.canManageRole(r)).map((r) => r.id))
	);

	function handleDragStart(e: DragEvent, role: RoleData) {
		if (!e.dataTransfer) return;
		draggedId = role.id;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', role.id);
	}

	function handleDragOver(e: DragEvent, role: RoleData) {
		if (!draggedId || draggedId === role.id || !manageableIds.has(role.id)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropTargetId = role.id;
		dropSide = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
	}

	function handleDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (related && (e.currentTarget as HTMLElement).contains(related)) return;
		dropTargetId = null;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		if (!draggedId || !dropTargetId) return resetDrag();

		const manageable = sortedRoles.filter((r) => manageableIds.has(r.id));
		const fromIdx = manageable.findIndex((r) => r.id === draggedId);
		const toIdx = manageable.findIndex((r) => r.id === dropTargetId);
		if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return resetDrag();

		const list = [...manageable];
		const [item] = list.splice(fromIdx, 1);
		let insertIdx = list.findIndex((r) => r.id === dropTargetId);
		if (insertIdx < 0) insertIdx = list.length;
		if (dropSide === 'below') insertIdx++;
		list.splice(insertIdx, 0, item);

		const roleIds = list.map((r) => r.id);
		reorderRoles(roleIds);
		commitReorder(roleIds);
		resetDrag();
	}

	function resetDrag() {
		draggedId = null;
		dropTargetId = null;
	}

	async function commitReorder(roleIds: string[]) {
		try {
			await api.roles.reorder(serverId, roleIds);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
			try {
				const fresh = await api.roles.list(serverId);
				setRoles(serverId, fresh as RoleData[]);
			} catch {}
		}
	}

	async function deleteRole(role: RoleData) {
		try {
			await api.roles.delete(role.id);
			toast.success('Role deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<p class="text-xs text-muted-foreground">
			{sortedRoles.length} role{sortedRoles.length === 1 ? '' : 's'} · drag to reorder
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
			{#each sortedRoles as role (role.id)}
				{@const manageable = perms.canManageRole(role)}
				{@const isDraggable = canManage && manageable && !role.is_default}
				{@const isDragged = draggedId === role.id}
				{@const isDropTarget = dropTargetId === role.id}
				<div
					class="relative"
					data-role-id={role.id}
					ondragover={(e) => handleDragOver(e, role)}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
				>
					{#if isDropTarget && dropSide === 'above'}
						<div class="absolute -top-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
					{/if}
					<div
						class="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2
							{manageable ? '' : 'opacity-60'}
							{isDragged ? 'opacity-40' : ''}"
						draggable={isDraggable ? 'true' : undefined}
						ondragstart={(e) => isDraggable && handleDragStart(e, role)}
						ondragend={resetDrag}
					>
						<div class="flex items-center gap-2">
							{#if isDraggable}
								<GripVertical class="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
							{/if}
							<span
								class="inline-block h-3 w-3 rounded-full"
								style="background-color: {role.color || '#99aab5'}"
							></span>
							<span class="text-sm font-medium text-foreground">{role.name}</span>
							{#if role.is_default}
								<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
									>default</span
								>
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
								<button
									onclick={() => (editing = role)}
									disabled={!manageable && !role.is_default}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
									title={manageable || role.is_default
										? 'Edit'
										: 'Read-only — above your highest role'}
								>
									<Pencil class="h-4 w-4" />
								</button>
								{#if !role.is_default}
									<button
										onclick={() => deleteRole(role)}
										disabled={!manageable}
										class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
										title={manageable
											? 'Delete'
											: 'Cannot delete role above your own'}
									>
										<Trash2 class="h-4 w-4" />
									</button>
								{/if}
							</div>
						{/if}
					</div>
					{#if isDropTarget && dropSide === 'below'}
						<div class="absolute -bottom-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
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
