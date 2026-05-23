<script lang="ts">
	import { onDestroy, onMount, type Component } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ServerList from '@syren/ui/fragments/server-list.svelte';
	import CreateServerDialog from '@syren/ui/fragments/create-server-dialog.svelte';
	import SwipeLayout from '@syren/ui/fragments/swipe-layout';
	import { setServers } from '@syren/app-core/stores/servers.svelte';
	import { checkAuth, getAuth } from '@syren/app-core/stores/auth.svelte';
	import { connectWs, disconnectWs } from '@syren/app-core/stores/ws.svelte';
	import { getPresenceData } from '@syren/app-core/stores/presence.svelte';
	import { startIdleWatcher, stopIdleWatcher, syncStatus } from '@syren/app-core/stores/idle.svelte';
	import { api, apiReady } from '@syren/app-core/api';
	import { realtimeReady } from '@syren/app-core/realtime';
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
	import { getPageSidebar, getPageMembers } from '@syren/ui/fragments/swipe-layout';

	let { children } = $props();
	let showCreateServer = $state(false);

	const auth = getAuth();
	// Per-page sidebar (DM list, channel sidebar, etc.). Child layouts
	// register their sidebar via setPageSidebar() so it lands in the
	// SwipeLayout drawer instead of being painted inline next to the
	// main panel — that way mobile gets a clean main view by default
	// and swipe-right reveals rail + page sidebar together.
	const pageSidebar = $derived(getPageSidebar().value);
	const pageMembers = $derived(getPageMembers().value);

	// Keep the idle watcher's baseline in sync with whatever the server says
	// our real status is (restored-from-DB on reconnect, another-tab change,
	// etc.). Internal auto-idle echoes are filtered inside syncStatus.
	$effect(() => {
		const did = auth.identity?.did;
		if (!did) return;
		syncStatus(getPresenceData(did).status);
	});

	const bootstrap = (async () => {
		if (import.meta.env.DEV) console.log('[(app) layout] bootstrap start');
		// Wait for the host to wire `api` + `realtime`. On web this gates on the
		// WASM client finishing init (kicked off non-blockingly from
		// `+layout.ts`); on native both gates resolve synchronously during the
		// root `load()`, so this is a no-op there. Without these waits the
		// `api.servers.list()` below would throw a "client not initialised"
		// error on web because we no longer block render on WASM init.
		await Promise.all([apiReady, realtimeReady]);
		const user = await checkAuth();
		if (import.meta.env.DEV) console.log('[(app) layout] checkAuth returned authed=', !!user?.did);
		if (!user) {
			if (import.meta.env.DEV) console.log('[(app) layout] no user; redirecting to /login');
			window.location.href = '/login';
			return false;
		}
		if (import.meta.env.DEV) console.log('[(app) layout] user authenticated; continuing bootstrap');

		// Connect WebSocket — server auto-identifies from httpOnly cookie
		connectWs();
		startIdleWatcher();
		loadTrustedDomains();
		loadRelations();

		try {
			const servers = await api.servers.list();
			setServers(servers);
		} catch {
			toast.error('Failed to load servers');
		}
		return true;
	})();

	// Defer the global screen-share overlay until after first paint. It
	// statically pulls in the LiveKit voice engine, which drags ~7 MB of
	// dependency (protobuf-es, livekit-client) into the main chunk. Loading
	// it via dynamic `import()` after mount keeps it out of the critical
	// boot path — screen-share itself is invisible until a peer actually
	// starts sharing, so users don't notice the deferred mount.
	let ScreenShareView = $state<Component | null>(null);
	onMount(() => {
		import('@syren/ui/fragments/screen-share-view.svelte')
			.then((m) => {
				ScreenShareView = m.default as Component;
			})
			.catch((err) => {
				// Chunk-load failure (offline, cache mismatch across deploys, …).
				// Overlay is best-effort visual feedback — drop it silently and
				// keep the rest of the app working. A dev warning helps surface
				// regressions during iteration.
				if (import.meta.env.DEV) {
					console.warn('[app-layout] screen-share-view chunk failed to load', err);
				}
			});
	});

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
			setServers(servers);
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
			<SwipeLayout sidebar={pageSidebar} members={pageMembers}>
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

		{#if ScreenShareView}
			<ScreenShareView />
		{/if}
	{:else}
		<div class="flex min-h-0 flex-1 items-center justify-center bg-background">
			<p class="text-sm text-muted-foreground">Redirecting to login...</p>
		</div>
	{/if}
{:catch err}
	<!-- Surfaces a WASM-init failure that came through the `apiReady` /
	     `realtimeReady` gates' rejection path. Without this `{:catch}` the
	     await above would hang the layout in the "Loading…" branch with no
	     recovery path. The reload button starts a fresh navigation, which
	     re-imports `+layout.ts`, resets `initPromise`, and retries the
	     whole chain. -->
	<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
		<p class="text-sm font-medium text-foreground">Couldn't start syren</p>
		<p class="max-w-xs text-xs text-muted-foreground">
			{err instanceof Error ? err.message : 'Unknown error during startup'}
		</p>
		<button
			type="button"
			onclick={() => window.location.reload()}
			class="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
		>
			Reload
		</button>
	</div>
{/await}
