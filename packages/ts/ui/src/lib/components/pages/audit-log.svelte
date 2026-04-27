<script lang="ts">
	import { ArrowLeft, ScrollText, Hash, X } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import AuditLogPanel from '@syren/ui/fragments/audit-log-panel.svelte';

	const serverState = getServerState();
	const perms = getPerms();
	const serverId = $derived(page.params.serverId ?? '');
	const server = $derived(serverState.activeServer);

	// Optional channel-scoped filter from `?channel_id=…`
	const channelId = $derived(page.url.searchParams.get('channel_id') ?? undefined);
	const channelInfo = $derived(
		channelId ? serverState.channels.find((c) => c.id === channelId) : undefined
	);
	const mode = $derived<'server' | 'channel'>(channelId ? 'channel' : 'server');

	function clearChannelFilter() {
		const url = new URL(page.url);
		url.searchParams.delete('channel_id');
		goto(url.pathname + url.search, { replaceState: true });
	}

	$effect(() => {
		// Wait for the perms snapshot to land before deciding whether to
		// kick the user out — bitmask defaults to 0 (no perms) until
		// `setServerPerms` runs, so a naive check would always redirect
		// on first paint.
		if (perms.serverId !== serverId) return;
		if (!perms.canViewAuditLog) {
			// Guard against route params being missing — `/channels/` is not
			// a canonical destination. Fall back to /channels/@me when there's
			// no serverId to redirect into.
			goto(serverId ? `/channels/${encodeURIComponent(serverId)}` : '/channels/@me', {
				replaceState: true
			});
		}
	});

	// Swipe-right to go back to the channel. Stop propagation so the
	// outer SwipeLayout doesn't also react (otherwise its swipe-right
	// handler would open the rail/sidebar drawer at the same time).
	const MIN_SWIPE_PX = 60;
	const MAX_SWIPE_MS = 500;
	const HORIZONTAL_DOMINANCE = 1.4;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let touchTracking = false;
	function onTouchStart(e: TouchEvent) {
		// Abort tracking the moment a 2nd finger lands so a pinch or
		// two-finger swipe can't accidentally fire a back-nav.
		if (e.touches.length !== 1) {
			touchTracking = false;
			return;
		}
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		touchStartTime = Date.now();
		touchTracking = true;
	}
	function onTouchEnd(e: TouchEvent) {
		if (!touchTracking) return;
		touchTracking = false;
		if (Date.now() - touchStartTime > MAX_SWIPE_MS) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		if (dx < MIN_SWIPE_PX) return;
		if (dx < Math.abs(dy) * HORIZONTAL_DOMINANCE) return;
		e.stopPropagation();
		goto(`/channels/${encodeURIComponent(serverId)}`);
	}
	function onTouchCancel() {
		touchTracking = false;
	}
</script>

<div
	role="region"
	aria-label="Audit log"
	class="flex min-h-0 min-w-0 flex-1 flex-col"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
	ontouchcancel={onTouchCancel}
>
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
		<Button
			variant="ghost"
			size="icon"
			onclick={() => goto(`/channels/${encodeURIComponent(serverId)}`)}
			title="Back to server"
		>
			<ArrowLeft class="h-4 w-4" />
		</Button>
		<ScrollText class="h-4 w-4 text-muted-foreground" />
		<span class="truncate text-sm font-semibold">
			{server?.name ?? 'Server'} · Audit Log
		</span>
		{#if channelInfo}
			<span
				class="ml-2 inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
			>
				<Hash class="h-3 w-3" />
				<span class="font-mono">{channelInfo.name}</span>
				<button
					type="button"
					onclick={clearChannelFilter}
					class="ml-1 rounded hover:bg-accent hover:text-foreground"
					title="Clear channel filter"
				>
					<X class="h-3 w-3" />
				</button>
			</span>
		{/if}
	</div>
	<main class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-4xl p-6 pb-24">
			{#if perms.canViewAuditLog}
				<p class="mb-4 text-xs text-muted-foreground">
					{#if channelInfo}
						Moderation actions scoped to <span class="font-mono">#{channelInfo.name}</span> — channel
						CRUD, message deletes, and purges. Click the × on the badge to see everything across the server.
					{:else}
						Every moderation action on this server, newest first. Filter by action type, actor, or content.
					{/if}
				</p>
				{#key channelId ?? 'server'}
					<AuditLogPanel {mode} {serverId} {channelId} />
				{/key}
			{/if}
		</div>
	</main>
</div>
