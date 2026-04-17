<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Hash, RotateCcw, Trash2, MoveRight } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { proxied } from '$lib/utils/proxy';
	import PaginatedTable from '$lib/components/paginated-table.svelte';
	import HardDeleteConfirmDialog from './hard-delete-confirm-dialog.svelte';

	interface TrashedMessage {
		id: string;
		channel_id: string;
		channel_name: string | null;
		sender_id: string;
		sender_instance_url?: string;
		content: string;
		attachments?: any[];
		created_at: string;
		deleted_at: string;
		deleted_by: string;
	}

	const { serverId }: { serverId: string } = $props();

	const perms = getPerms();
	let refreshSignal = $state(0);
	let pendingHard = $state<TrashedMessage | null>(null);

	function load(params: {
		limit: number;
		offset: number;
		q?: string;
		filters: Record<string, unknown>;
	}) {
		return api.servers.trashMessages(serverId, {
			limit: params.limit,
			offset: params.offset,
			q: params.q,
			sender_id: (params.filters.sender_id as string | undefined) ?? undefined,
			deleted_by: (params.filters.deleted_by as string | undefined) ?? undefined,
			since: (params.filters.since as string | undefined) ?? undefined,
			until: (params.filters.until as string | undefined) ?? undefined
		});
	}

	async function restore(row: TrashedMessage) {
		try {
			await api.channels.restoreMessage(row.channel_id, row.id);
			toast.success('Message restored');
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to restore');
		}
	}

	async function hardDelete(row: TrashedMessage) {
		try {
			await api.channels.hardDeleteMessage(row.channel_id, row.id);
			toast.success('Message deleted forever');
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete forever');
			throw err;
		}
	}

	function jumpTo(row: TrashedMessage) {
		goto(
			`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(row.channel_id)}?jump=${encodeURIComponent(row.id)}`
		);
	}

	function formatAgo(iso: string): string {
		const then = new Date(iso).getTime();
		const delta = Date.now() - then;
		const m = Math.floor(delta / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return `${d}d ago`;
	}

	const columns = [
		{ key: 'channel', label: 'Channel' },
		{ key: 'sender', label: 'Sender' },
		{ key: 'content', label: 'Content' },
		{ key: 'deleted_by', label: 'Deleted by' },
		{ key: 'deleted_at', label: 'Deleted' }
	];

	const filters = [
		{ key: 'sender_id', kind: 'text', label: 'Sender DID', placeholder: 'did:syr:…', mono: true },
		{ key: 'deleted_by', kind: 'text', label: 'Deleted by DID', placeholder: 'did:syr:…', mono: true },
		{ key: 'since', kind: 'date', label: 'Deleted since' },
		{ key: 'until', kind: 'date', label: 'Deleted until' }
	] as const;
</script>

<PaginatedTable
	{columns}
	{load}
	{refreshSignal}
	filters={filters as any}
	rowKey={(r: TrashedMessage) => r.id}
	searchPlaceholder="Search message content…"
	emptyLabel="No trashed messages"
	pageSize={25}
>
	{#snippet cell(row: TrashedMessage, key: string)}
		{#if key === 'channel'}
			<div class="flex items-center gap-1 text-xs">
				<Hash class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span class="truncate font-medium">{row.channel_name ?? row.channel_id}</span>
			</div>
		{:else if key === 'sender'}
			{@const sprofile = resolveProfile(row.sender_id, row.sender_instance_url)}
			<div class="flex items-center gap-2">
				<Avatar.Root class="h-6 w-6 shrink-0">
					{#if sprofile.avatar_url}
						<Avatar.Image
							src={proxied(sprofile.avatar_url)}
							alt={displayName(sprofile, row.sender_id)}
						/>
					{/if}
					<Avatar.Fallback class="text-[9px]">
						{displayName(sprofile, row.sender_id).slice(0, 2).toUpperCase()}
					</Avatar.Fallback>
				</Avatar.Root>
				<span class="truncate text-xs">{displayName(sprofile, row.sender_id)}</span>
			</div>
		{:else if key === 'content'}
			<span
				class="line-clamp-2 max-w-[40ch] text-xs text-muted-foreground"
				title={row.content}
			>
				{row.content || (row.attachments?.length
					? `(${row.attachments.length} attachment${row.attachments.length === 1 ? '' : 's'})`
					: '(empty)')}
			</span>
		{:else if key === 'deleted_by'}
			{@const dprofile = resolveProfile(row.deleted_by, undefined)}
			<span class="truncate text-xs">{displayName(dprofile, row.deleted_by)}</span>
		{:else if key === 'deleted_at'}
			<span
				class="whitespace-nowrap text-xs text-muted-foreground"
				title={new Date(row.deleted_at).toLocaleString()}
			>
				{formatAgo(row.deleted_at)}
			</span>
		{/if}
	{/snippet}

	{#snippet actions(row: TrashedMessage)}
		<div class="flex items-center justify-end gap-1">
			<button
				type="button"
				onclick={() => jumpTo(row)}
				title="Jump to channel"
				class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<MoveRight class="h-4 w-4" />
			</button>
			<button
				type="button"
				onclick={() => restore(row)}
				title="Restore message"
				class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<RotateCcw class="h-4 w-4" />
			</button>
			{#if perms.canHardDelete}
				<button
					type="button"
					onclick={() => (pendingHard = row)}
					title="Delete forever"
					class="rounded p-1.5 text-destructive hover:bg-destructive/10"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			{/if}
		</div>
	{/snippet}
</PaginatedTable>

{#if pendingHard}
	<HardDeleteConfirmDialog
		open={true}
		kind="message"
		onConfirm={async () => {
			const r = pendingHard;
			if (r) await hardDelete(r);
		}}
		onClose={() => (pendingHard = null)}
	/>
{/if}
