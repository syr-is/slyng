<script lang="ts">
	import { ArrowLeft, ScrollText } from '@lucide/svelte';
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

	// Redirect on perm loss (e.g. role stripped mid-view)
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
	</div>
	<main class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-4xl p-6 pb-24">
			{#if perms.canViewAuditLog}
				<p class="mb-4 text-xs text-muted-foreground">
					Every moderation action on this server, newest first. Filter by action type, actor, or content.
				</p>
				<AuditLogPanel mode="server" {serverId} />
			{/if}
		</div>
	</main>
</div>
