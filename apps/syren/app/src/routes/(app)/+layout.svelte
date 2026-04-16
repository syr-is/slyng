<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ServerList from '$lib/components/server-list.svelte';
	import CreateServerDialog from '$lib/components/create-server-dialog.svelte';
	import ScreenShareView from '$lib/components/screen-share-view.svelte';
	import { setServers } from '$lib/stores/servers.svelte';
	import { checkAuth, getAuth } from '$lib/stores/auth.svelte';
	import { connectWs, disconnectWs } from '$lib/stores/ws.svelte';
	import { getPresenceData } from '$lib/stores/presence.svelte';
	import { startIdleWatcher, stopIdleWatcher, syncStatus } from '$lib/stores/idle.svelte';
	import { api } from '$lib/api';
	// Side-effect imports — ensure WS listeners in these stores register
	// BEFORE connectWs() runs, so we don't miss the READY snapshot or
	// any messages that arrive in the gap before child pages mount.
	import '$lib/stores/presence.svelte';
	import '$lib/stores/messages.svelte';
	import '$lib/stores/roles.svelte';
	import '$lib/stores/members.svelte';
	import '$lib/stores/profiles.svelte';
	import '$lib/stores/stories.svelte';
	import '$lib/stores/emojis.svelte';
	import '$lib/stores/gifs.svelte';
	import '$lib/stores/typing.svelte';
	import '$lib/stores/posts.svelte';
	import { loadTrustedDomains } from '$lib/stores/trusted-domains.svelte';
	import { loadRelations, clearRelations } from '$lib/stores/relations.svelte';

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
		connectWs(window.location.origin);
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
	<div class="flex h-screen items-center justify-center bg-background">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{:then ready}
	{#if ready}
		<div class="flex h-screen overflow-hidden bg-background">
			<ServerList onCreateServer={() => (showCreateServer = true)} />
			<div class="flex min-h-0 min-w-0 flex-1">
				{@render children?.()}
			</div>
		</div>

		<CreateServerDialog
			open={showCreateServer}
			onClose={() => (showCreateServer = false)}
			onCreate={handleCreateServer}
		/>

		<ScreenShareView />
	{:else}
		<div class="flex h-screen items-center justify-center bg-background">
			<p class="text-sm text-muted-foreground">Redirecting to login...</p>
		</div>
	{/if}
{/await}
