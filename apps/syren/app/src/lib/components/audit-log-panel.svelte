<script lang="ts">
	import { onDestroy } from 'svelte';
	import { WsOp } from '@syren/types';
	import { onWsEvent } from '$lib/stores/ws.svelte';
	import { api } from '$lib/api';
	import PaginatedTable from './paginated-table.svelte';
	import AuditEventRow from './audit-event-row.svelte';

	interface Row {
		id?: string;
		actor_id: string;
		action: string;
		target_kind: string;
		target_id: string | null;
		target_user_id?: string | null;
		metadata: Record<string, unknown>;
		reason: string | null;
		batch_id: string | null;
		created_at: string;
	}

	const {
		mode,
		serverId,
		userId
	}: {
		mode: 'server' | 'user';
		serverId: string;
		userId?: string;
	} = $props();

	let refreshSignal = $state(0);

	// Live append: another mod takes a moderation action → audit row arrives
	// via WS → debounce-bump refresh so a bulk purge (N rows, N events) still
	// only triggers one refetch, and filter out events that don't target this
	// user when we're in `user` mode.
	let pending: ReturnType<typeof setTimeout> | null = null;
	const unsub = onWsEvent(WsOp.AUDIT_LOG_APPEND, (data) => {
		const row = data as Partial<Row>;
		if (mode === 'user' && userId && row.target_user_id !== userId) return;
		if (pending) clearTimeout(pending);
		pending = setTimeout(() => {
			refreshSignal++;
			pending = null;
		}, 200);
	});
	onDestroy(() => {
		unsub();
		if (pending) clearTimeout(pending);
	});

	function load(params: { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc'; q?: string }) {
		if (mode === 'user') {
			return api.servers.memberAuditLog(serverId, userId!, {
				limit: params.limit,
				offset: params.offset,
				q: params.q
			});
		}
		return api.servers.auditLog(serverId, {
			limit: params.limit,
			offset: params.offset,
			q: params.q
		});
	}

	const columns = [{ key: 'event', label: 'Event' }];
</script>

<PaginatedTable
	{columns}
	{load}
	{refreshSignal}
	rowKey={(r: Row) => r.id ?? `${r.actor_id}-${r.created_at}-${r.action}`}
	searchPlaceholder="Search by actor DID / reason…"
	emptyLabel="No events yet"
	pageSize={25}
>
	{#snippet cell(row: Row, _key: string)}
		<AuditEventRow {row} />
	{/snippet}
</PaginatedTable>
