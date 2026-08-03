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
	import { untrack } from 'svelte';
	import { ScrollText, Hash, X, Maximize2 } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import * as Sheet from '@slyng/ui/sheet';
	import { getServerState } from '@slyng/app-core/stores/servers.svelte';
	import AuditLogPanel from './audit-log-panel.svelte';

	const {
		serverId,
		channelId,
		onClose
	}: {
		serverId: string;
		/** The channel the log was opened from — the filter's starting value. */
		channelId?: string;
		onClose: () => void;
	} = $props();

	const serverState = getServerState();
	const server = $derived(serverState.activeServer);

	// The prop seeds the filter, it does not pin it. Opening from a channel
	// starts scoped to that channel, because that is what you came to look at;
	// clearing the chip widens to the whole server without reopening from a
	// different entry point. Server-wide entries pass no channelId and start
	// unfiltered.
	// `untrack` states the intent the bare read cannot: seed once, then own it.
	// Without it Svelte warns that only the initial value is captured — which is
	// precisely what is wanted here, since re-syncing to the prop would undo a
	// cleared filter on the next render. Each open remounts the sheet, so a
	// fresh entry point always seeds afresh.
	let activeChannelId = $state<string | undefined>(untrack(() => channelId));

	const channelInfo = $derived(
		activeChannelId ? serverState.channels.find((c) => c.id === activeChannelId) : undefined
	);
	const mode = $derived<'server' | 'channel'>(activeChannelId ? 'channel' : 'server');

	function expand() {
		const base = `/channels/${encodeURIComponent(serverId)}/audit-log`;
		// Carry the filter as it stands now, not as it arrived — clearing the
		// chip and then expanding should land on the server-wide page.
		const url = activeChannelId
			? `${base}?channel_id=${encodeURIComponent(activeChannelId)}`
			: base;
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
		<!--
			Sits beside the sheet's own close control rather than on a row of its
			own: it is a secondary way to reach the same data, not an action worth
			a full-width button above the table. Always visible and labelled, so
			it stays reachable on touch where a hover reveal would not (§6).
		-->
		<button
			type="button"
			onclick={expand}
			aria-label="Open the audit log as a full page"
			title="Open full page"
			class="absolute right-12 top-2 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground tap:top-0.5 tap:size-11 motion-safe:active:scale-95"
		>
			<Maximize2 class="h-4 w-4" />
		</button>
		<Sheet.Header class="border-b border-border p-4">
			<Sheet.Title class="flex items-center gap-2 pr-16">
				<ScrollText class="h-4 w-4 shrink-0 text-muted-foreground" />
				<span class="min-w-0 truncate">{server?.name ?? 'Server'} · Audit Log</span>
				{#if channelInfo}
					<span
						class="inline-flex min-w-0 max-w-[16ch] items-center gap-1 rounded-md border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-xs font-normal text-muted-foreground"
					>
						<Hash class="h-3 w-3 shrink-0" />
						<span class="truncate font-mono">{channelInfo.name}</span>
						<!--
							The chip is the filter's off switch, not decoration. Sized to
							the 44px tap target on touch (§6) while staying compact with a
							mouse, so it is dismissible without a hover reveal.
						-->
						<button
							type="button"
							onclick={() => (activeChannelId = undefined)}
							aria-label="Show actions from the whole server"
							title="Clear channel filter"
							class="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent hover:text-foreground tap:size-8 motion-safe:active:scale-95"
						>
							<X class="h-3 w-3" />
						</button>
					</span>
				{/if}
			</Sheet.Title>
			<Sheet.Description class="text-xs">
				{#if channelInfo}
					Moderation actions scoped to <span class="font-mono">#{channelInfo.name}</span>. Clear the
					filter to see everything across the server.
				{:else}
					Every moderation action on this server, newest first.
				{/if}
			</Sheet.Description>
		</Sheet.Header>

		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			<!--
				Keyed on the active filter so clearing the chip remounts the panel:
				it owns its own pagination and query state, and re-scoping a live
				table would otherwise leave page 3 of one channel showing under a
				server-wide heading.
			-->
			{#key activeChannelId ?? 'server'}
				<AuditLogPanel {mode} {serverId} channelId={activeChannelId} />
			{/key}
		</div>
	</Sheet.Content>
</Sheet.Root>
