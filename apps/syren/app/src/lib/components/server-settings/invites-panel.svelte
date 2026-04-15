<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Copy, Check, Trash2, Globe, AtSign, Server } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { proxied } from '$lib/utils/proxy';
	import PaginatedTable from '$lib/components/paginated-table.svelte';
	import CreateInviteForm from './create-invite-form.svelte';

	interface InviteRow {
		id?: string;
		code: string;
		created_by: string;
		created_at: string;
		expires_at: string | null;
		max_uses: number;
		uses: number;
		target_kind: 'open' | 'instance' | 'did';
		target_value: string | null;
		label: string | null;
	}

	const { serverId }: { serverId: string } = $props();

	const auth = getAuth();
	const perms = getPerms();
	const memberStore = getMembers();

	let refreshSignal = $state(0);
	let copiedCode = $state<string | null>(null);

	function load(params: { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc'; q?: string }) {
		return api.servers.listInvites(serverId, params);
	}

	async function copyLink(code: string) {
		const url = `${window.location.origin}/invite/${code}`;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = url;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		copiedCode = code;
		setTimeout(() => { if (copiedCode === code) copiedCode = null; }, 1500);
	}

	async function revoke(code: string) {
		try {
			await api.servers.deleteInvite(serverId, code);
			toast.success('Invite revoked');
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to revoke');
		}
	}

	function canRevoke(row: InviteRow): boolean {
		return perms.canManageInvites || row.created_by === auth.identity?.did;
	}

	function instanceFor(did: string): string | undefined {
		return memberStore.list.find((m) => m.user_id === did)?.syr_instance_url;
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

	function formatExpiry(iso: string | null): string {
		if (!iso) return 'Never';
		const then = new Date(iso).getTime();
		const delta = then - Date.now();
		if (delta <= 0) return 'Expired';
		const m = Math.floor(delta / 60000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		return `${d}d`;
	}

	const columns = [
		{ key: 'code', label: 'Code' },
		{ key: 'scope', label: 'Scope' },
		{ key: 'uses', label: 'Uses', class: 'whitespace-nowrap' },
		{ key: 'created_by', label: 'Created by' },
		{ key: 'created_at', label: 'Created', sortable: true, class: 'whitespace-nowrap' },
		{ key: 'expires_at', label: 'Expires', class: 'whitespace-nowrap' }
	];
</script>

<div class="space-y-4">
	{#if perms.canCreateInvites}
		<CreateInviteForm {serverId} onCreated={() => refreshSignal++} />
	{/if}

	{#if !perms.canManageInvites}
		<p class="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
			You can create invites but not view others' invites. Ask a server manager for the <span class="font-mono">MANAGE_INVITES</span> permission to see the full list.
		</p>
	{:else}
	<PaginatedTable
		{columns}
		{load}
		{refreshSignal}
		rowKey={(r: InviteRow) => r.code}
		searchPlaceholder="Search by code, target, label…"
		initialSort={{ field: 'created_at', order: 'desc' }}
		emptyLabel="No invites yet"
	>
		{#snippet cell(row: InviteRow, key: string)}
			{#if key === 'code'}
				<div class="flex flex-col gap-0.5">
					<button
						type="button"
						onclick={() => copyLink(row.code)}
						class="inline-flex items-center gap-1.5 text-left font-mono text-xs hover:text-primary"
						title="Copy invite link"
					>
						<span>{row.code}</span>
						{#if copiedCode === row.code}
							<Check class="h-3 w-3 text-green-500" />
						{:else}
							<Copy class="h-3 w-3 opacity-60" />
						{/if}
					</button>
					{#if row.label}
						<span class="text-[11px] text-muted-foreground">{row.label}</span>
					{/if}
				</div>
			{:else if key === 'scope'}
				{#if row.target_kind === 'open'}
					<span class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						<Globe class="h-3 w-3" /> Anyone
					</span>
				{:else if row.target_kind === 'instance'}
					<span class="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-500">
						<Server class="h-3 w-3" /> {row.target_value}
					</span>
				{:else if row.target_kind === 'did'}
					<span
						class="inline-flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-400"
						title={row.target_value ?? ''}
					>
						<AtSign class="h-3 w-3" /> {(row.target_value ?? '').slice(0, 20)}…
					</span>
				{/if}
			{:else if key === 'uses'}
				<span class="text-xs font-mono">
					{row.uses} / {row.max_uses === 0 ? '∞' : row.max_uses}
				</span>
			{:else if key === 'created_by'}
				{@const profile = resolveProfile(row.created_by, instanceFor(row.created_by))}
				{@const name = displayName(profile, row.created_by)}
				<div class="flex items-center gap-1.5">
					<Avatar.Root class="h-5 w-5">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
						{/if}
						<Avatar.Fallback class="text-[8px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
					<span class="truncate text-xs">{name}</span>
				</div>
			{:else if key === 'created_at'}
				<span class="text-xs text-muted-foreground" title={new Date(row.created_at).toLocaleString()}>
					{formatAgo(row.created_at)}
				</span>
			{:else if key === 'expires_at'}
				<span class="text-xs text-muted-foreground">{formatExpiry(row.expires_at)}</span>
			{/if}
		{/snippet}

		{#snippet actions(row: InviteRow)}
			{#if canRevoke(row)}
				<button
					onclick={() => revoke(row.code)}
					class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
					title="Revoke"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			{/if}
		{/snippet}
	</PaginatedTable>
	{/if}
</div>
