<script lang="ts">
	import { onDestroy } from 'svelte';
	import { WsOp, AuditActionSchema } from '@syren/types';
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
		channel_id?: string | null;
		metadata: Record<string, unknown>;
		reason: string | null;
		batch_id: string | null;
		created_at: string;
	}

	const {
		mode,
		serverId,
		userId,
		channelId
	}: {
		mode: 'server' | 'user' | 'channel';
		serverId: string;
		userId?: string;
		channelId?: string;
	} = $props();

	let refreshSignal = $state(0);

	// Live append: debounce-bump so a bulk purge (N rows) fires one refetch,
	// and filter out events that don't match the current scope.
	let pending: ReturnType<typeof setTimeout> | null = null;
	const unsub = onWsEvent(WsOp.AUDIT_LOG_APPEND, (data) => {
		const row = data as Partial<Row>;
		if (mode === 'user' && userId && row.target_user_id !== userId) return;
		if (mode === 'channel' && channelId && row.channel_id !== channelId) return;
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

	function load(params: {
		limit: number;
		offset: number;
		sort?: string;
		order?: 'asc' | 'desc';
		q?: string;
		filters: Record<string, unknown>;
	}) {
		const action = (params.filters.action as string | undefined) || undefined;
		if (mode === 'user') {
			return api.servers.memberAuditLog(serverId, userId!, {
				limit: params.limit,
				offset: params.offset,
				q: params.q,
				action
			});
		}
		return api.servers.auditLog(serverId, {
			limit: params.limit,
			offset: params.offset,
			q: params.q,
			channel_id: mode === 'channel' ? channelId : undefined,
			action,
			actor_id: (params.filters.actor_id as string | undefined) || undefined,
			target_user_id: (params.filters.target_user_id as string | undefined) || undefined,
			since: (params.filters.since as string | undefined) || undefined,
			until: (params.filters.until as string | undefined) || undefined
		});
	}

	const columns = [{ key: 'event', label: 'Event' }];

	// Filter set differs by scope: user-mode only accepts `action` because the
	// backend endpoint doesn't plumb actor/target/date filters for that route.
	const actionOptions = AuditActionSchema.options.map((a) => ({
		value: a,
		label: a.replace(/_/g, ' ')
	}));

	const filters = $derived(
		mode === 'user'
			? ([{ key: 'action', kind: 'select', label: 'Action', options: actionOptions, placeholder: 'Any action' }] as const)
			: ([
					{ key: 'action', kind: 'select', label: 'Action', options: actionOptions, placeholder: 'Any action' },
					{ key: 'actor_id', kind: 'text', label: 'Actor DID', placeholder: 'did:syr:…', mono: true },
					{ key: 'target_user_id', kind: 'text', label: 'Target user DID', placeholder: 'did:syr:…', mono: true },
					{ key: 'since', kind: 'date', label: 'Since' },
					{ key: 'until', kind: 'date', label: 'Until' }
				] as const)
	);
</script>

<PaginatedTable
	{columns}
	{load}
	{refreshSignal}
	filters={filters as any}
	rowKey={(r: Row) => r.id ?? `${r.actor_id}-${r.created_at}-${r.action}`}
	searchPlaceholder="Search by actor DID / reason…"
	emptyLabel="No events yet"
	pageSize={25}
>
	{#snippet cell(row: Row, _key: string)}
		<AuditEventRow {row} onChanged={() => refreshSignal++} />
	{/snippet}
</PaginatedTable>
