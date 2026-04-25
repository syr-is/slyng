<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Crown, UserMinus, Ban } from '@lucide/svelte';
	import { WsOp, Permissions } from '@syren/types';
	import { onWsEvent } from '@syren/app-core/stores/ws.svelte';
	import * as Tooltip from '@syren/ui/tooltip';
	import { api } from '@syren/app-core/api';
	import MemberActionDialog from './member-action-dialog.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { getRoles, type RoleData } from '@syren/app-core/stores/roles.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import PaginatedTable from '../paginated-table.svelte';
	import MemberRolesPopover from '../member-roles-popover.svelte';

	interface MemberRow {
		user_id: string;
		syr_instance_url?: string;
		joined_at: string;
		role_ids?: string[];
		permissions?: string;
		permission_count?: number;
	}

	const PERM_ENTRIES: [string, bigint][] = Object.entries(Permissions);
	const ADMIN_FLAG = Permissions.ADMINISTRATOR;

	function permFlagNames(permStr: string | undefined): string[] {
		if (!permStr) return [];
		const p = BigInt(permStr);
		if ((p & ADMIN_FLAG) === ADMIN_FLAG) return ['ADMINISTRATOR'];
		return PERM_ENTRIES.filter(([, flag]) => (p & flag) === flag).map(([name]) => name);
	}

	const { serverId }: { serverId: string } = $props();

	const roleStore = getRoles();
	const perms = getPerms();
	const serverState = getServerState();
	const serverOwnerId = $derived(serverState.activeServerOwnerId);

	let refreshSignal = $state(0);

	// The paginated table caches its page items locally. Role assignments,
	// kicks, and new joins arrive via WS — bump the refresh signal so the
	// currently-visible page refetches + rerenders with fresh role_ids.
	let pendingRefresh: ReturnType<typeof setTimeout> | null = null;
	function scheduleRefresh() {
		if (pendingRefresh) clearTimeout(pendingRefresh);
		pendingRefresh = setTimeout(() => {
			refreshSignal++;
			pendingRefresh = null;
		}, 150);
	}

	const unsubUpdate = onWsEvent(WsOp.MEMBER_UPDATE, () => scheduleRefresh());
	const unsubRemove = onWsEvent(WsOp.MEMBER_REMOVE, () => scheduleRefresh());
	onDestroy(() => {
		unsubUpdate();
		unsubRemove();
		if (pendingRefresh) clearTimeout(pendingRefresh);
	});

	function load(params: { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc'; q?: string }) {
		return api.servers.membersPage(serverId, params) as Promise<{ items: MemberRow[]; total: number }>;
	}

	let actionTarget = $state<{ kind: 'kick' | 'ban'; user_id: string; name: string } | null>(null);

	function openAction(kind: 'kick' | 'ban', user_id: string, name: string) {
		actionTarget = { kind, user_id, name };
	}

	function memberRolesFor(m: MemberRow): RoleData[] {
		const ids = (m.role_ids ?? []).map((r) => String(r));
		return roleStore.list.filter((r) => ids.includes(r.id)).sort((a, b) => b.position - a.position);
	}

	const columns = [
		{ key: 'name', label: 'Member' },
		{ key: 'roles', label: 'Roles' },
		{ key: 'permissions', label: 'Permissions', sortable: true, class: 'whitespace-nowrap' },
		{ key: 'joined_at', label: 'Joined', sortable: true, class: 'whitespace-nowrap' }
	];

	function formatDate(iso: string) {
		try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
	}
</script>

<PaginatedTable
	{columns}
	{load}
	{refreshSignal}
	rowKey={(m: MemberRow) => m.user_id}
	searchPlaceholder="Search by DID / nickname…"
	initialSort={{ field: 'joined_at', order: 'desc' }}
	emptyLabel="No members match"
>
	{#snippet cell(row: MemberRow, key: string)}
		{#if key === 'name'}
			{@const profile = resolveProfile(row.user_id, row.syr_instance_url)}
			{@const name = displayName(profile, row.user_id)}
			{@const handle = federatedHandle(profile, row.user_id)}
			{@const isOwner = serverOwnerId && row.user_id === serverOwnerId}
			<div class="flex items-center gap-2">
				<Avatar.Root class="h-8 w-8 shrink-0">
					{#if profile.avatar_url}
						<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
					{/if}
					<Avatar.Fallback class="text-[10px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
				</Avatar.Root>
				<div class="min-w-0">
					<div class="flex items-center gap-1">
						<span class="truncate text-sm font-medium">{name}</span>
						{#if isOwner}<Crown class="h-3 w-3 shrink-0 text-amber-500" />{/if}
					</div>
					<p class="truncate font-mono text-[11px] text-muted-foreground">{handle}</p>
				</div>
			</div>
		{:else if key === 'roles'}
			{@const rs = memberRolesFor(row)}
			{#if rs.length === 0}
				<span class="text-[10px] text-muted-foreground">—</span>
			{:else}
				<Tooltip.Root delayDuration={150}>
					<Tooltip.Trigger>
						{#snippet child({ props }: { props: Record<string, unknown> })}
							{#if rs.length === 1}
								{@const r = rs[0]}
								<span
									{...props}
									class="inline-block max-w-[14ch] truncate rounded px-1.5 py-0.5 text-[10px] cursor-help"
									style="background-color: {(r.color || '#99aab5')}33; color: {r.color || '#99aab5'}"
								>{r.name}</span>
							{:else}
								{@const top = rs[0]}
								<span
									{...props}
									class="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] cursor-help"
									style="background-color: {(top.color || '#99aab5')}33; color: {top.color || '#99aab5'}"
								>
									<span
										class="h-1.5 w-1.5 shrink-0 rounded-full"
										style="background-color: {top.color || '#99aab5'}"
									></span>
									{rs.length} roles
								</span>
							{/if}
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content
						side="top"
						sideOffset={6}
						class="max-w-xs bg-popover text-popover-foreground border border-border p-2 shadow-md"
						arrowClasses="bg-popover border-l border-b border-border"
					>
						<div class="flex flex-col gap-1">
							{#each rs as r (r.id)}
								<span class="flex items-center gap-1.5 text-[11px]">
									<span
										class="h-2 w-2 shrink-0 rounded-full"
										style="background-color: {r.color || '#99aab5'}"
									></span>
									<span class="truncate" style="color: {r.color || 'inherit'}">{r.name}</span>
								</span>
							{/each}
						</div>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		{:else if key === 'permissions'}
			{@const count = row.permission_count ?? 0}
			{@const isAdmin = !!row.permissions && (BigInt(row.permissions) & ADMIN_FLAG) === ADMIN_FLAG}
			{@const flagList = permFlagNames(row.permissions)}
			<span
				class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]
					{isAdmin ? 'bg-amber-500/20 text-amber-500' : count > 0 ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground'}"
				title={isAdmin ? 'ADMINISTRATOR (all permissions)' : flagList.join(', ') || 'none'}
			>
				{isAdmin ? 'Admin' : `${count} perm${count === 1 ? '' : 's'}`}
			</span>
		{:else if key === 'joined_at'}
			<span class="text-xs text-muted-foreground">{formatDate(row.joined_at)}</span>
		{/if}
	{/snippet}

	{#snippet actions(row: MemberRow)}
		{@const isOwner = serverOwnerId && row.user_id === serverOwnerId}
		{@const rs = memberRolesFor(row)}
		{@const profile = resolveProfile(row.user_id, row.syr_instance_url)}
		{@const name = displayName(profile, row.user_id)}
		{@const canManage = perms.canManageMember(row, roleStore.list)}
		<div class="flex items-center gap-1 justify-end">
			{#if perms.canManageRoles}
				<MemberRolesPopover
					{serverId}
					userId={row.user_id}
					assigned={rs}
					allRoles={roleStore.list}
				/>
			{/if}
			{#if perms.canKick && !isOwner && canManage}
				<button
					onclick={() => openAction('kick', row.user_id, name)}
					class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
					title="Kick"
				>
					<UserMinus class="h-4 w-4" />
				</button>
			{/if}
			{#if perms.canBan && !isOwner && canManage}
				<button
					onclick={() => openAction('ban', row.user_id, name)}
					class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
					title="Ban"
				>
					<Ban class="h-4 w-4" />
				</button>
			{/if}
		</div>
	{/snippet}
</PaginatedTable>

{#if actionTarget}
	<MemberActionDialog
		open={true}
		kind={actionTarget.kind}
		{serverId}
		targetUserId={actionTarget.user_id}
		targetName={actionTarget.name}
		onClose={() => (actionTarget = null)}
		onDone={() => { refreshSignal++; }}
	/>
{/if}
