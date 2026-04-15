<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Sheet from '@syren/ui/sheet';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Separator } from '@syren/ui/separator';
	import {
		Crown,
		UserMinus,
		Ban,
		Trash2,
		RotateCcw,
		Hash,
		ArrowUpRight,
		History,
		MessageSquare,
		Copy
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { WsOp, Permissions } from '@syren/types';
	import { api } from '$lib/api';
	import { onWsEvent } from '$lib/stores/ws.svelte';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getRoles } from '$lib/stores/roles.svelte';
	import { getServerState } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { proxied } from '$lib/utils/proxy';
	import PaginatedTable from './paginated-table.svelte';
	import MemberActionDialog from './server-settings/member-action-dialog.svelte';
	import PurgeMessagesDialog from './server-settings/purge-messages-dialog.svelte';
	import RoleToggleList from './role-toggle-list.svelte';
	import AuditLogPanel from './audit-log-panel.svelte';

	const {
		serverId,
		userId,
		instanceUrl,
		onClose
	}: {
		serverId: string;
		userId: string;
		instanceUrl?: string;
		onClose: () => void;
	} = $props();

	const auth = getAuth();
	const perms = getPerms();
	const memberStore = getMembers();
	const roleStore = getRoles();
	const serverState = getServerState();

	const profile = $derived(resolveProfile(userId, instanceUrl));
	const name = $derived(displayName(profile, userId));
	const handle = $derived(federatedHandle(profile, userId));
	const isOwner = $derived(!!serverState.activeServerOwnerId && userId === serverState.activeServerOwnerId);
	const isSelf = $derived(userId === auth.identity?.did);

	const member = $derived(memberStore.list.find((m) => m.user_id === userId));
	const memberRoles = $derived.by(() => {
		if (!member?.role_ids?.length) return [];
		const ids = member.role_ids.map((r) => String(r));
		return roleStore.list
			.filter((r) => ids.includes(r.id))
			.sort((a, b) => b.position - a.position);
	});

	const joinedAt = $derived.by(() => {
		const raw = (member as any)?.joined_at;
		if (!raw) return null;
		const d = new Date(raw as string);
		return isNaN(d.getTime()) ? null : d.toLocaleString();
	});

	// Effective permissions count for the target member
	const targetPerms = $derived.by(() => {
		if (!member) return 0n;
		if (isOwner) return Permissions.ADMINISTRATOR;
		const ids = (member.role_ids ?? []).map((r) => String(r));
		let p = 0n;
		for (const role of roleStore.list) {
			if ((role as any).is_default || ids.includes(role.id)) {
				p |= BigInt((role as any).permissions ?? '0');
			}
		}
		return p;
	});
	const targetPermCount = $derived.by(() => {
		if ((targetPerms & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) {
			return Object.keys(Permissions).length;
		}
		let c = 0;
		let x = targetPerms;
		while (x > 0n) {
			if (x & 1n) c++;
			x >>= 1n;
		}
		return c;
	});
	const permNames = $derived.by(() => {
		if ((targetPerms & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return ['ADMINISTRATOR'];
		return Object.entries(Permissions)
			.filter(([, flag]) => (targetPerms & flag) === flag)
			.map(([name]) => name);
	});

	// Stats
	let stats = $state<{ total: number; first_at: string | null; last_at: string | null } | null>(null);
	// Ban state
	let activeBan = $state<{ banned_by: string; banned_at: string; reason: string | null } | null>(null);
	let banHistory = $state<
		Array<{ banned_by: string; banned_at: string; reason: string | null; active: boolean; unbanned_at?: string | null; unbanned_by?: string | null }>
	>([]);
	// Refresh bumpers
	let messagesRefresh = $state(0);

	async function loadStats() {
		if (!perms.canManageMessages) return;
		try {
			stats = await api.servers.memberMessageStats(serverId, userId);
		} catch {
			stats = null;
		}
	}
	async function loadBanHistory() {
		if (!perms.canBan) return;
		try {
			banHistory = await api.servers.memberBanHistory(serverId, userId);
			activeBan = banHistory.find((b) => b.active) ?? null;
		} catch {
			banHistory = [];
			activeBan = null;
		}
	}

	$effect(() => {
		void userId; // refetch when target changes (it won't here — the parent re-mounts)
		loadStats();
		loadBanHistory();
	});

	// Live refresh on moderation events for this target
	const unsubDelete = onWsEvent(WsOp.MESSAGE_DELETE, () => {
		loadStats();
		messagesRefresh++;
	});
	const unsubMsgUpdate = onWsEvent(WsOp.MESSAGE_UPDATE, (data) => {
		const msg = data as { sender_id?: string; deleted?: boolean };
		// Soft-delete is a MESSAGE_UPDATE now — refresh if it targets this user
		if (msg?.deleted && msg.sender_id === userId) {
			loadStats();
			messagesRefresh++;
		}
	});
	const unsubMember = onWsEvent(WsOp.MEMBER_UPDATE, () => { /* role changes reflect via store */ });
	// Ban / unban / role changes initiated by another tab: the audit event
	// for this user → refresh the ban banner + stats in lock-step.
	const unsubAudit = onWsEvent(WsOp.AUDIT_LOG_APPEND, (data) => {
		const row = data as { target_user_id?: string | null; action?: string };
		if (row?.target_user_id !== userId) return;
		if (row.action === 'member_ban' || row.action === 'member_unban') {
			loadBanHistory();
		}
		if (row.action === 'message_delete' || row.action === 'message_purge') {
			loadStats();
		}
	});
	onDestroy(() => {
		unsubDelete();
		unsubMsgUpdate();
		unsubMember();
		unsubAudit();
	});

	// Action dialogs
	let actionKind = $state<'kick' | 'ban' | null>(null);
	let showPurge = $state(false);

	async function unbanNow() {
		try {
			await api.servers.unbanMember(serverId, userId);
			toast.success('User unbanned');
			await loadBanHistory();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unban');
		}
	}

	function loadMessages(params: { limit: number; offset: number; sort?: string; order?: 'asc' | 'desc'; q?: string }) {
		return api.servers.memberMessages(serverId, userId, {
			limit: params.limit,
			offset: params.offset,
			q: params.q
		});
	}

	async function deleteMessage(channelId: string, messageId: string) {
		try {
			await api.channels.deleteMessage(channelId, messageId);
			toast.success('Message deleted');
			messagesRefresh++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	function jumpTo(channelId: string, messageId: string) {
		onClose();
		goto(
			`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(channelId)}?jump=${encodeURIComponent(messageId)}`
		);
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Copied');
		} catch {
			/* swallow */
		}
	}

	function formatAgo(iso: string | null | undefined): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}

	function formatRel(iso: string): string {
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
		{ key: 'content', label: 'Message' },
		{ key: 'channel', label: 'Channel', class: 'whitespace-nowrap' },
		{ key: 'created_at', label: 'When', class: 'whitespace-nowrap' }
	];
</script>

<Sheet.Root open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
		<Sheet.Header class="border-b border-border p-4">
			<Sheet.Title class="flex items-center gap-3">
				<Avatar.Root class="h-10 w-10">
					{#if profile.avatar_url}
						<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
					{/if}
					<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
				</Avatar.Root>
				<div class="min-w-0 flex-1 text-left">
					<div class="flex items-center gap-1">
						<span class="truncate">{name}</span>
						{#if isOwner}<Crown class="h-4 w-4 text-amber-500" />{/if}
					</div>
					<p class="truncate font-mono text-xs font-normal text-muted-foreground">{handle}</p>
				</div>
			</Sheet.Title>
			<Sheet.Description class="sr-only">Moderation view for {name}</Sheet.Description>
		</Sheet.Header>

		<div class="flex-1 space-y-5 overflow-y-auto p-4">
			<!-- Account summary -->
			<section class="space-y-1 rounded-md border border-border bg-card p-3">
				<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
					<span class="text-muted-foreground">DID</span>
					<span class="truncate font-mono">{userId}</span>
					<button
						type="button"
						onclick={() => copy(userId)}
						class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Copy DID"
					>
						<Copy class="h-3 w-3" />
					</button>
				</div>
				<div class="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
					<span class="text-muted-foreground">Instance</span>
					<span class="truncate font-mono">{instanceUrl ?? (member as any)?.syr_instance_url ?? '—'}</span>
				</div>
				<div class="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
					<span class="text-muted-foreground">Joined</span>
					<span>{joinedAt ?? '—'}</span>
				</div>
				<div class="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
					<span class="text-muted-foreground">Permissions</span>
					<span title={permNames.join(', ')}>
						{#if isOwner}
							<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-500">Admin (owner)</span>
						{:else}
							{targetPermCount} perm{targetPermCount === 1 ? '' : 's'}
						{/if}
					</span>
				</div>
				{#if activeBan}
					<div class="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
						Currently banned · by {displayName(resolveProfile(activeBan.banned_by, undefined), activeBan.banned_by)} · {formatRel(activeBan.banned_at)}
						{#if activeBan.reason}
							<p class="mt-0.5">Reason: {activeBan.reason}</p>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Actions -->
			<section>
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h3>
				<div class="flex flex-wrap gap-2">
					{#if perms.canKick && !isOwner && !isSelf}
						<Button size="sm" variant="outline" onclick={() => (actionKind = 'kick')}>
							<UserMinus class="mr-1.5 h-4 w-4" /> Kick…
						</Button>
					{/if}
					{#if perms.canBan && !isOwner && !isSelf}
						{#if activeBan}
							<Button size="sm" variant="outline" onclick={unbanNow}>
								<RotateCcw class="mr-1.5 h-4 w-4" /> Unban
							</Button>
						{:else}
							<Button size="sm" variant="outline" class="text-destructive" onclick={() => (actionKind = 'ban')}>
								<Ban class="mr-1.5 h-4 w-4" /> Ban…
							</Button>
						{/if}
					{/if}
					{#if perms.canManageMessages && !isSelf}
						<Button size="sm" variant="outline" class="text-destructive" onclick={() => (showPurge = true)}>
							<Trash2 class="mr-1.5 h-4 w-4" /> Purge messages…
						</Button>
					{/if}
					{#if !perms.canKick && !perms.canBan && !perms.canManageMessages && !perms.canManageRoles}
						<p class="text-xs text-muted-foreground">You don't have moderation permissions on this server.</p>
					{/if}
				</div>
			</section>

			<!-- Roles -->
			{#if perms.canManageRoles && !isOwner}
				<section>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</h3>
					<RoleToggleList
						{serverId}
						{userId}
						assigned={memberRoles}
						allRoles={roleStore.list}
					/>
				</section>
			{:else if memberRoles.length > 0}
				<section>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</h3>
					<div class="flex flex-wrap gap-1">
						{#each memberRoles as r (r.id)}
							<span
								class="rounded px-1.5 py-0.5 text-[11px]"
								style="background-color: {(r.color || '#99aab5')}33; color: {r.color || '#99aab5'}"
							>{r.name}</span>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Message stats -->
			{#if perms.canManageMessages}
				<section class="rounded-md border border-border bg-card p-3">
					<h3 class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<MessageSquare class="h-3.5 w-3.5" /> Message stats
					</h3>
					{#if !stats}
						<p class="text-xs text-muted-foreground">Loading…</p>
					{:else}
						<div class="grid grid-cols-3 gap-3 text-xs">
							<div>
								<p class="text-muted-foreground">Total</p>
								<p class="text-sm font-semibold">{stats.total}</p>
							</div>
							<div>
								<p class="text-muted-foreground">First</p>
								<p>{stats.first_at ? formatRel(stats.first_at) : '—'}</p>
							</div>
							<div>
								<p class="text-muted-foreground">Last</p>
								<p>{stats.last_at ? formatRel(stats.last_at) : '—'}</p>
							</div>
						</div>
					{/if}
				</section>
			{/if}

			<!-- Moderation log — unified event timeline targeting this user -->
			{#if perms.canViewAuditLog}
				<section>
					<h3 class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<History class="h-3.5 w-3.5" /> Moderation log
					</h3>
					<AuditLogPanel mode="user" {serverId} {userId} />
				</section>
			{/if}

			<!-- Messages -->
			{#if perms.canManageMessages}
				<section>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messages</h3>
					<PaginatedTable
						{columns}
						load={loadMessages}
						refreshSignal={messagesRefresh}
						rowKey={(m: any) => m.id}
						searchPlaceholder="Search content…"
						emptyLabel="No messages in this server"
						pageSize={25}
					>
						{#snippet cell(row: any, key: string)}
							{#if key === 'content'}
								<div class="max-w-sm">
									<p class="line-clamp-2 text-xs">{row.content || (row.attachments?.length ? '[attachment]' : '')}</p>
								</div>
							{:else if key === 'channel'}
								<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
									<Hash class="h-3 w-3" />
									<span class="truncate">{row.channel_name ?? row.channel_id}</span>
								</span>
							{:else if key === 'created_at'}
								<span class="text-xs text-muted-foreground" title={formatAgo(row.created_at)}>
									{formatRel(row.created_at)}
								</span>
							{/if}
						{/snippet}
						{#snippet actions(row: any)}
							<div class="flex items-center gap-1 justify-end">
								<button
									type="button"
									onclick={() => jumpTo(row.channel_id, row.id)}
									class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Jump to message"
								>
									<ArrowUpRight class="h-4 w-4" />
								</button>
								<button
									type="button"
									onclick={() => deleteMessage(row.channel_id, row.id)}
									class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						{/snippet}
					</PaginatedTable>
				</section>
			{/if}
		</div>

		<Separator />
		<Sheet.Footer class="p-4">
			<Button variant="outline" onclick={onClose}>Close</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>

{#if actionKind}
	<MemberActionDialog
		open={true}
		kind={actionKind}
		{serverId}
		targetUserId={userId}
		targetName={name}
		onClose={() => (actionKind = null)}
		onDone={() => { loadBanHistory(); loadStats(); messagesRefresh++; }}
	/>
{/if}

{#if showPurge}
	<PurgeMessagesDialog
		open={true}
		{serverId}
		targetUserId={userId}
		targetName={name}
		onClose={() => (showPurge = false)}
		onDone={() => { loadStats(); messagesRefresh++; }}
	/>
{/if}
