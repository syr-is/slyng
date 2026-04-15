<script lang="ts">
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { Shield } from '@lucide/svelte';
	import RoleToggleList from './role-toggle-list.svelte';

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
		<div class="p-1">
			<RoleToggleList {serverId} {userId} {assigned} {allRoles} />
		</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>
