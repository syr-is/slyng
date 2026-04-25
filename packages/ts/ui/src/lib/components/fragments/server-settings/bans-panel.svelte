<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { RotateCcw, Ban } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import PaginatedTable from '../paginated-table.svelte';

	interface BanRow {
		id?: string;
		server_id: string;
		user_id: string;
		syr_instance_url?: string;
		banned_by: string;
		banned_at: string;
		reason: string | null;
	}

	const { serverId }: { serverId: string } = $props();

	const perms = getPerms();
	let refreshSignal = $state(0);

	function load(params: { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc'; q?: string }) {
		return api.servers.listBans(serverId, params) as Promise<{ items: BanRow[]; total: number }>;
	}

	async function unban(userId: string) {
		try {
			await api.servers.unbanMember(serverId, userId);
			toast.success('User unbanned');
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unban');
		}
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
		{ key: 'user', label: 'User' },
		{ key: 'reason', label: 'Reason' },
		{ key: 'banned_by', label: 'Banned by' },
		{ key: 'banned_at', label: 'Banned', sortable: true, class: 'whitespace-nowrap' }
	];
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Ban class="h-4 w-4" />
		<span>Banned users are blocked from rejoining until unbanned.</span>
	</div>

	<PaginatedTable
		{columns}
		{load}
		{refreshSignal}
		rowKey={(b: BanRow) => b.user_id}
		searchPlaceholder="Search by DID / reason…"
		initialSort={{ field: 'banned_at', order: 'desc' }}
		emptyLabel="No bans yet"
	>
		{#snippet cell(row: BanRow, key: string)}
			{#if key === 'user'}
				{@const profile = resolveProfile(row.user_id, row.syr_instance_url)}
				{@const name = displayName(profile, row.user_id)}
				{@const handle = federatedHandle(profile, row.user_id)}
				<div class="flex items-center gap-2">
					<Avatar.Root class="h-8 w-8 shrink-0">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
						{/if}
						<Avatar.Fallback class="text-[10px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{name}</p>
						<p class="truncate font-mono text-[11px] text-muted-foreground">{handle}</p>
					</div>
				</div>
			{:else if key === 'reason'}
				<span class="text-xs text-muted-foreground">{row.reason ?? '—'}</span>
			{:else if key === 'banned_by'}
				{@const bprofile = resolveProfile(row.banned_by, undefined)}
				<span class="text-xs">{displayName(bprofile, row.banned_by)}</span>
			{:else if key === 'banned_at'}
				<span class="text-xs text-muted-foreground" title={new Date(row.banned_at).toLocaleString()}>
					{formatAgo(row.banned_at)}
				</span>
			{/if}
		{/snippet}

		{#snippet actions(row: BanRow)}
			{#if perms.canBan}
				<button
					onclick={() => unban(row.user_id)}
					class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					title="Unban"
				>
					<RotateCcw class="h-4 w-4" />
				</button>
			{/if}
		{/snippet}
	</PaginatedTable>
</div>
