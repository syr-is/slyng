<script lang="ts">
	import { Hash, Shield, MessageSquare } from '@lucide/svelte';
	import TrashChannelsTable from './trash-channels-table.svelte';
	import TrashRolesTable from './trash-roles-table.svelte';
	import TrashMessagesTable from './trash-messages-table.svelte';

	const { serverId }: { serverId: string } = $props();

	type SubTab = 'channels' | 'roles' | 'messages';
	let activeSubTab = $state<SubTab>('channels');

	const subTabs: { id: SubTab; label: string; icon: typeof Hash }[] = [
		{ id: 'channels', label: 'Channels', icon: Hash },
		{ id: 'roles', label: 'Roles', icon: Shield },
		{ id: 'messages', label: 'Messages', icon: MessageSquare }
	];
</script>

<div class="space-y-4">
	<p class="text-sm text-muted-foreground">
		Trashed items are hidden from the server but kept on disk for auditability. Restore puts them
		back where they were. Delete forever is irreversible and only available to roles with the
		<span class="font-mono">HARD_DELETE</span> permission.
	</p>

	<div class="flex items-center gap-1 border-b border-border">
		{#each subTabs as t (t.id)}
			{@const Icon = t.icon}
			<button
				type="button"
				onclick={() => (activeSubTab = t.id)}
				class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors
					{activeSubTab === t.id
					? 'border-foreground font-medium text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Icon class="h-4 w-4" />
				{t.label}
			</button>
		{/each}
	</div>

	{#if activeSubTab === 'channels'}
		<TrashChannelsTable {serverId} />
	{:else if activeSubTab === 'roles'}
		<TrashRolesTable {serverId} />
	{:else}
		<TrashMessagesTable {serverId} />
	{/if}
</div>
