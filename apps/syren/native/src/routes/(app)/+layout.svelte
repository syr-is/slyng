<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ServerList from '@syren/ui/fragments/server-list.svelte';
	import CreateServerDialog from '@syren/ui/fragments/create-server-dialog.svelte';
	import ScreenShareView from '@syren/ui/fragments/screen-share-view.svelte';
	import SwipeLayout from '@syren/ui/fragments/swipe-layout';
	import { setServers } from '@syren/app-core/stores/servers.svelte';
	import { checkAuth, getAuth } from '@syren/app-core/stores/auth.svelte';
	import { connectWs, disconnectWs } from '@syren/app-core/stores/ws.svelte';
	import { getPresenceData } from '@syren/app-core/stores/presence.svelte';
	import { startIdleWatcher, stopIdleWatcher, syncStatus } from '@syren/app-core/stores/idle.svelte';
	import { api } from '@syren/app-core/api';
	// Side-effect imports — ensure WS listeners in these stores register
	// BEFORE connectWs() runs, so we don't miss the READY snapshot or
	// any messages that arrive in the gap before child pages mount.
	import '@syren/app-core/stores/presence.svelte';
	import '@syren/app-core/stores/messages.svelte';
	import '@syren/app-core/stores/roles.svelte';
	import '@syren/app-core/stores/members.svelte';
	import '@syren/app-core/stores/profiles.svelte';
	import '@syren/app-core/stores/stories.svelte';
	import '@syren/app-core/stores/emojis.svelte';
	import '@syren/app-core/stores/gifs.svelte';
	import '@syren/app-core/stores/typing.svelte';
	import '@syren/app-core/stores/posts.svelte';
	import { loadTrustedDomains } from '@syren/app-core/stores/trusted-domains.svelte';
	import { loadRelations, clearRelations } from '@syren/app-core/stores/relations.svelte';

	let { children } = $props();
	let showCreateServer = $state(false);

	const auth = getAuth();

	// Keep the idle watcher's baseline in sync with whatever the server says
	// our real status is (restored-from-DB on reconnect, another-tab change,
	// etc.). Internal auto-idle echoes are filtered inside syncStatus.
	$effect(() => {
		const did = auth.identity?.did;
		if (!did) return;
		syncStatus(getPresenceData(did).status);
	});

	const bootstrap = (async () => {
		const user = await checkAuth();
		if (!user) {
			window.location.href = '/login';
			return false;
		}

		// Connect WebSocket — server auto-identifies from httpOnly cookie
		connectWs();
		startIdleWatcher();
		loadTrustedDomains();
		loadRelations();

		try {
			const servers = await api.servers.list();
			setServers(servers as any[]);
		} catch {
			toast.error('Failed to load servers');
		}
		return true;
	})();

	onDestroy(() => {
		disconnectWs();
		stopIdleWatcher();
		clearRelations();
	});

	async function handleCreateServer(data: {
		name: string;
		icon_url?: string;
		banner_url?: string;
		invite_background_url?: string;
		description?: string;
	}) {
		try {
			await api.servers.create(data);
			const servers = await api.servers.list();
			setServers(servers as any[]);
		} catch {
			toast.error('Failed to create server');
		}
	}
</script>

{#await bootstrap}
	<div class="flex min-h-0 flex-1 items-center justify-center bg-background">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{:then ready}
	{#if ready}
		<div class="min-h-0 flex-1 overflow-hidden bg-background">
			<SwipeLayout>
				{#snippet rail()}
					<ServerList onCreateServer={() => (showCreateServer = true)} />
				{/snippet}
				{#snippet main()}
					<div class="flex h-full min-h-0 min-w-0 flex-1">
						{@render children?.()}
					</div>
				{/snippet}
			</SwipeLayout>
		</div>

		<CreateServerDialog
			open={showCreateServer}
			onClose={() => (showCreateServer = false)}
			onCreate={handleCreateServer}
		/>

		<ScreenShareView />
	{:else}
		<div class="flex min-h-0 flex-1 items-center justify-center bg-background">
			<p class="text-sm text-muted-foreground">Redirecting to login...</p>
		</div>
	{/if}
{/await}
