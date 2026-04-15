<script lang="ts">
	import { ArrowLeft, ScrollText, Hash, X } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { getServerState } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import AuditLogPanel from '$lib/components/audit-log-panel.svelte';

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
		if (!perms.canViewAuditLog) {
			goto(`/channels/${encodeURIComponent(serverId)}`, { replaceState: true });
		}
	});
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
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
