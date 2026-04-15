<script lang="ts">
	import { ArrowLeft, User, Shield, Users, Ticket, Ban, AlertTriangle } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { getServerState } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import ProfilePanel from '$lib/components/server-settings/profile-panel.svelte';
	import RolesPanel from '$lib/components/server-settings/roles-panel.svelte';
	import MembersPanel from '$lib/components/server-settings/members-panel.svelte';
	import InvitesPanel from '$lib/components/server-settings/invites-panel.svelte';
	import BansPanel from '$lib/components/server-settings/bans-panel.svelte';
	import DangerPanel from '$lib/components/server-settings/danger-panel.svelte';

	type Tab = 'profile' | 'roles' | 'members' | 'invites' | 'bans' | 'danger';

	const auth = getAuth();
	const serverState = getServerState();
	const perms = getPerms();
	const serverId = $derived(page.params.serverId ?? '');
	const server = $derived(serverState.activeServer);
	const isOwner = $derived(!!server && server.owner_id === auth.identity?.did);

	let activeTab = $state<Tab>('profile');

	const tabs: { id: Tab; label: string; icon: typeof User; show: boolean }[] = $derived([
		{ id: 'profile', label: 'Profile', icon: User, show: true },
		{ id: 'roles', label: 'Roles', icon: Shield, show: true },
		{ id: 'members', label: 'Members', icon: Users, show: true },
		{ id: 'invites', label: 'Invites', icon: Ticket, show: perms.canCreateInvites || perms.canManageInvites },
		{ id: 'bans', label: 'Bans', icon: Ban, show: perms.canBan },
		{ id: 'danger', label: 'Danger zone', icon: AlertTriangle, show: isOwner }
	]);

	// If the route's first render lands on a tab the user can't see, fall back
	$effect(() => {
		const allowed = tabs.find((t) => t.id === activeTab && t.show);
		if (!allowed) activeTab = 'profile';
	});
</script>

<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
	<!-- Left nav -->
	<aside class="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
		<div class="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
			<Button
				variant="ghost"
				size="icon"
				onclick={() => goto(`/channels/${encodeURIComponent(serverId)}`)}
				title="Back to server"
			>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<span class="truncate text-sm font-semibold">{server?.name ?? 'Server'} settings</span>
		</div>
		<nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
			{#each tabs.filter((t) => t.show) as tab (tab.id)}
				{@const Icon = tab.icon}
				<button
					onclick={() => (activeTab = tab.id)}
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors
						{activeTab === tab.id
						? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}
						{tab.id === 'danger' ? 'text-destructive/80 hover:text-destructive' : ''}"
				>
					<Icon class="h-4 w-4 shrink-0" />
					<span>{tab.label}</span>
				</button>
			{/each}
		</nav>
	</aside>

	<!-- Content -->
	<main class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-4xl p-6 pb-24">
			{#if activeTab === 'profile'}
				<h1 class="mb-4 text-xl font-semibold">Server profile</h1>
				<ProfilePanel {serverId} />
			{:else if activeTab === 'roles'}
				<h1 class="mb-4 text-xl font-semibold">Roles</h1>
				<RolesPanel {serverId} />
			{:else if activeTab === 'members'}
				<h1 class="mb-4 text-xl font-semibold">Members</h1>
				<MembersPanel {serverId} />
			{:else if activeTab === 'invites'}
				<h1 class="mb-4 text-xl font-semibold">Invites</h1>
				<InvitesPanel {serverId} />
			{:else if activeTab === 'bans'}
				<h1 class="mb-4 text-xl font-semibold">Bans</h1>
				<BansPanel {serverId} />
			{:else if activeTab === 'danger'}
				<h1 class="mb-4 text-xl font-semibold text-destructive">Danger zone</h1>
				<DangerPanel {serverId} />
			{/if}
		</div>
	</main>
</div>
