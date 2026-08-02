<script lang="ts">
	/**
	 * The audit log as a side sheet, with an escape hatch to the full page.
	 *
	 * Two surfaces, one body: this and `pages/audit-log.svelte` both render
	 * `AuditLogPanel`, so the table, its filters and its live AUDIT_LOG_APPEND
	 * subscription exist once. The sheet is the common case — check who deleted
	 * a channel without losing the conversation behind it — and the page is for
	 * when the log itself is the task, or when it needs a URL to share.
	 *
	 * Expanding hands the page everything the sheet was showing, channel filter
	 * included, so the transition is continuous rather than a reset.
	 */
	import { ScrollText, Hash, X, Maximize2 } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import * as Sheet from '@slyng/ui/sheet';
	import { Button } from '@slyng/ui/button';
	import { getServerState } from '@slyng/app-core/stores/servers.svelte';
	import AuditLogPanel from './audit-log-panel.svelte';

	const {
		serverId,
		channelId,
		onClose
	}: {
		serverId: string;
		/** Present when opened from a channel — scopes the log to it. */
		channelId?: string;
		onClose: () => void;
	} = $props();

	const serverState = getServerState();
	const server = $derived(serverState.activeServer);
	const channelInfo = $derived(
		channelId ? serverState.channels.find((c) => c.id === channelId) : undefined
	);
	const mode = $derived<'server' | 'channel'>(channelId ? 'channel' : 'server');

	function expand() {
		const base = `/channels/${encodeURIComponent(serverId)}/audit-log`;
		const url = channelId ? `${base}?channel_id=${encodeURIComponent(channelId)}` : base;
		// Close first: the sheet is a modal layer, and leaving it mounted across
		// the navigation traps focus on a route that no longer owns it.
		onClose();
		goto(url);
	}
</script>

<Sheet.Root open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Sheet.Content
		side="right"
		class="flex w-full flex-col gap-0 p-0 pt-[var(--slyng-sai-top,env(safe-area-inset-top,0px))] pb-[var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))] sm:max-w-2xl"
	>
		<Sheet.Header class="border-b border-border p-4">
			<Sheet.Title class="flex items-center gap-2 pr-8">
				<ScrollText class="h-4 w-4 shrink-0 text-muted-foreground" />
				<span class="min-w-0 truncate">{server?.name ?? 'Server'} · Audit Log</span>
				{#if channelInfo}
					<span
						class="inline-flex min-w-0 max-w-[14ch] items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-normal text-muted-foreground"
					>
						<Hash class="h-3 w-3 shrink-0" />
						<span class="truncate font-mono">{channelInfo.name}</span>
					</span>
				{/if}
			</Sheet.Title>
			<Sheet.Description class="text-xs">
				{#if channelInfo}
					Moderation actions scoped to <span class="font-mono">#{channelInfo.name}</span>. Expand to
					see everything across the server.
				{:else}
					Every moderation action on this server, newest first.
				{/if}
			</Sheet.Description>
			<!--
				Expand sits in the header rather than the footer so it stays
				reachable without scrolling the table, and is a real button with a
				label — an icon-only affordance discoverable on hover alone is a
				no-op on touch (AI.md §6).
			-->
			<div class="flex justify-end pt-1">
				<Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" onclick={expand}>
					<Maximize2 class="h-3.5 w-3.5" />
					Open full page
				</Button>
			</div>
		</Sheet.Header>

		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#key channelId ?? 'server'}
				<AuditLogPanel {mode} {serverId} {channelId} />
			{/key}
		</div>
	</Sheet.Content>
</Sheet.Root>
