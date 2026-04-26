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
		Copy,
		Shield,
		Eye,
		Volume2,
		Loader2,
		ChevronDown,
		ChevronUp
	} from '@lucide/svelte';
	import { Check, X, Minus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { WsOp, Permissions } from '@syren/types';
	import { api } from '@syren/app-core/api';
	import { onWsEvent } from '@syren/app-core/stores/ws.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { getMembers } from '@syren/app-core/stores/members.svelte';
	import { getRoles } from '@syren/app-core/stores/roles.svelte';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
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
	const isFormerMember = $derived(!member && memberStore.list.length > 0);
	const memberRoles = $derived.by(() => {
		if (!member?.role_ids?.length) return [];
		const ids = member.role_ids.map((r) => String(r));
		return roleStore.list
			.filter((r) => ids.includes(r.id))
			.sort((a, b) => b.position - a.position);
	});

	// Hierarchy gate: actor must outrank target. Owner bypasses; self always
	// allowed (no-ops never reach the server). Used by every action button
	// below — kicks, bans, and role assignment all become no-ops when actor
	// can't manage the target.
	const canManageThisMember = $derived(
		perms.canManageMember(member ?? { user_id: userId }, roleStore.list)
	);

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

	// ── Server-level user permission overrides ──
	const USER_PERM_FLAGS: Array<{ key: string; label: string; flag: bigint }> = [
		{ key: 'READ_MESSAGES', label: 'View Channels', flag: Permissions.READ_MESSAGES },
		{ key: 'SEND_MESSAGES', label: 'Send Messages', flag: Permissions.SEND_MESSAGES },
		{ key: 'MANAGE_MESSAGES', label: 'Manage Messages', flag: Permissions.MANAGE_MESSAGES },
		{ key: 'EMBED_LINKS', label: 'Embed Links', flag: Permissions.EMBED_LINKS },
		{ key: 'ATTACH_FILES', label: 'Attach Files', flag: Permissions.ATTACH_FILES },
		{ key: 'ADD_REACTIONS', label: 'Add Reactions', flag: Permissions.ADD_REACTIONS },
		{ key: 'CONNECT', label: 'Connect (Voice)', flag: Permissions.CONNECT },
		{ key: 'SPEAK', label: 'Speak (Voice)', flag: Permissions.SPEAK },
		{ key: 'CREATE_INVITES', label: 'Create Invites', flag: Permissions.CREATE_INVITES },
		{ key: 'MANAGE_CHANNELS', label: 'Manage Channels', flag: Permissions.MANAGE_CHANNELS },
		{ key: 'KICK_MEMBERS', label: 'Kick Members', flag: Permissions.KICK_MEMBERS },
		{ key: 'BAN_MEMBERS', label: 'Ban Members', flag: Permissions.BAN_MEMBERS }
	];

	let showUserPerms = $state(false);
	let userPermAllow = $state(0n);
	let userPermDeny = $state(0n);
	let userPermLoading = $state(false);
	let userPermLoaded = $state(false);
	let savingUserPerm = $state(false);

	async function loadUserOverride() {
		userPermLoading = true;
		try {
			const all = (await api.overrides.list(serverId)) as Array<{
				id: string; scope_type: string; scope_id: string | null;
				target_type: string; target_id: string; allow: string; deny: string;
			}>;
			const match = all.find(
				(o) => o.scope_type === 'server' && !o.scope_id && o.target_type === 'user' && o.target_id === userId
			);
			userPermAllow = BigInt(match?.allow ?? '0');
			userPermDeny = BigInt(match?.deny ?? '0');
			userPermLoaded = true;
		} catch {
			toast.error('Failed to load user overrides');
		}
		userPermLoading = false;
	}

	function toggleUserPerms() {
		showUserPerms = !showUserPerms;
		if (showUserPerms && !userPermLoaded && !userPermLoading) loadUserOverride();
	}

	type TriState = 'allow' | 'deny' | 'inherit';

	function getUserPermState(flag: bigint): TriState {
		if ((userPermAllow & flag) === flag) return 'allow';
		if ((userPermDeny & flag) === flag) return 'deny';
		return 'inherit';
	}

	async function cycleUserPerm(flag: bigint) {
		const current = getUserPermState(flag);
		let a = userPermAllow & ~flag;
		let d = userPermDeny & ~flag;
		if (current === 'inherit') a = a | flag;
		else if (current === 'allow') d = d | flag;
		// deny → inherit (both cleared)

		savingUserPerm = true;
		try {
			await api.overrides.upsert(serverId, {
				scope_type: 'server',
				scope_id: null,
				target_type: 'user',
				target_id: userId,
				allow: a.toString(),
				deny: d.toString()
			});
			userPermAllow = a;
			userPermDeny = d;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		savingUserPerm = false;
	}

	// ── View server as user (permission tree) ──
	const canViewPermsButton = $derived(perms.canManageRoles && !isSelf);
	const permsButtonDisabled = $derived(!canManageThisMember && !isOwner);

	let showPermTree = $state(false);
	let permTreeLoading = $state(false);
	let permTreeData = $state<{
		server: { permissions: string };
		categories: Array<{
			id: string; name: string; position: number; permissions: string;
			channels: Array<{
				id: string; name: string; type: string; position: number;
				permissions: string; can_view: boolean;
			}>;
		}>;
		uncategorized: Array<{
			id: string; name: string; type: string; position: number;
			permissions: string; can_view: boolean;
		}>;
	} | null>(null);

	async function loadPermTree() {
		if (permTreeLoading) return;
		permTreeLoading = true;
		try {
			permTreeData = await api.roles.permissionTree(serverId, userId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load permission tree');
		}
		permTreeLoading = false;
	}

	function togglePermTree() {
		showPermTree = !showPermTree;
		if (showPermTree && !permTreeData && !permTreeLoading) loadPermTree();
	}

	function permNamesFromBitmask(bitmask: string): string[] {
		const p = BigInt(bitmask);
		if ((p & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return ['ADMINISTRATOR'];
		return Object.entries(Permissions)
			.filter(([, flag]) => (p & flag) === flag)
			.map(([n]) => n);
	}

	let hoveredNode = $state<string | null>(null);

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

	// Swipe-right to dismiss. Sheet renders into a portal so SwipeLayout's
	// own gesture never sees these events; we don't need stopPropagation.
	const MIN_SWIPE_PX = 60;
	const MAX_SWIPE_MS = 500;
	const HORIZONTAL_DOMINANCE = 1.4;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let touchTracking = false;
	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		touchStartTime = Date.now();
		touchTracking = true;
	}
	function onTouchEnd(e: TouchEvent) {
		if (!touchTracking) return;
		touchTracking = false;
		if (Date.now() - touchStartTime > MAX_SWIPE_MS) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		if (dx < MIN_SWIPE_PX) return;
		if (dx < Math.abs(dy) * HORIZONTAL_DOMINANCE) return;
		onClose();
	}
</script>

<Sheet.Root open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Sheet.Content
		side="right"
		class="flex w-full flex-col gap-0 p-0 pt-[var(--syren-sai-top,env(safe-area-inset-top,0px))] pb-[var(--syren-sai-bottom,env(safe-area-inset-bottom,0px))] sm:max-w-xl"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
	>
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
				{#if isFormerMember}
					<div class="mt-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
						Not a member — left or was removed. Only ban is available.
					</div>
				{/if}
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
					{#if perms.canKick && !isOwner && !isSelf && canManageThisMember && !isFormerMember}
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
					{#if perms.canManageMessages && !isSelf && !isFormerMember}
						<Button size="sm" variant="outline" class="text-destructive" onclick={() => (showPurge = true)}>
							<Trash2 class="mr-1.5 h-4 w-4" /> Purge messages…
						</Button>
					{/if}
					{#if !canManageThisMember && !isOwner && !isSelf && (perms.canKick || perms.canBan)}
						<p class="text-xs text-muted-foreground">
							This member's highest role is at or above yours — kick / ban disabled.
						</p>
					{/if}
					{#if !perms.canKick && !perms.canBan && !perms.canManageMessages && !perms.canManageRoles}
						<p class="text-xs text-muted-foreground">You don't have moderation permissions on this server.</p>
					{/if}
				</div>
			</section>

			<!-- Roles -->
			{#if perms.canManageRoles && !isOwner && !isFormerMember}
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

			<!-- Server-level user permissions -->
			{#if perms.canManageRoles && !isSelf && !isOwner && canManageThisMember && !isFormerMember}
				<section>
					<button
						type="button"
						onclick={toggleUserPerms}
						class="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-xs hover:bg-accent"
					>
						<span class="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
							<Shield class="h-3.5 w-3.5" />
							User permissions
						</span>
						{#if userPermLoading}
							<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{:else if showUserPerms}
							<ChevronUp class="h-3.5 w-3.5 text-muted-foreground" />
						{:else}
							<ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</button>
					{#if showUserPerms && userPermLoaded}
						<div class="mt-2 rounded-md border border-border bg-card p-3">
							<p class="mb-2 text-[11px] text-muted-foreground">
								Server-level overrides for this user. These take priority over role permissions but are overridden by channel/category-level overrides.
							</p>
							<div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1 text-xs">
								<span class="text-muted-foreground">Permission</span>
								<span class="w-7 text-center text-green-500" title="Allow"><Check class="mx-auto h-3 w-3" /></span>
								<span class="w-7 text-center text-destructive" title="Deny"><X class="mx-auto h-3 w-3" /></span>
								<span class="w-7 text-center text-muted-foreground" title="Inherit"><Minus class="mx-auto h-3 w-3" /></span>
								{#each USER_PERM_FLAGS as { label, flag } (label)}
									{@const state = getUserPermState(flag)}
									<span>{label}</span>
									<button type="button" onclick={() => cycleUserPerm(flag)} disabled={savingUserPerm}
										class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'allow' ? 'bg-green-500/20 text-green-500' : 'text-muted-foreground/30 hover:text-green-500/60'}">
										<Check class="h-3 w-3" />
									</button>
									<button type="button" onclick={() => cycleUserPerm(flag)} disabled={savingUserPerm}
										class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'deny' ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground/30 hover:text-destructive/60'}">
										<X class="h-3 w-3" />
									</button>
									<button type="button" onclick={() => cycleUserPerm(flag)} disabled={savingUserPerm}
										class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'inherit' ? 'bg-muted text-muted-foreground' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}">
										<Minus class="h-3 w-3" />
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</section>
			{/if}

			<!-- View server as user — nested permission tree -->
			{#if canViewPermsButton && !isFormerMember}
				<section>
					<button
						type="button"
						onclick={togglePermTree}
						disabled={permsButtonDisabled}
						class="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
						title={permsButtonDisabled ? "This member's role is at or above yours" : 'View server as this user'}
					>
						<span class="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
							<Eye class="h-3.5 w-3.5" />
							View server as user
						</span>
						{#if permTreeLoading}
							<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{:else if showPermTree}
							<ChevronUp class="h-3.5 w-3.5 text-muted-foreground" />
						{:else}
							<ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</button>
					{#if permsButtonDisabled}
						<p class="mt-1 text-[11px] text-muted-foreground">
							This member's role is at or above yours.
						</p>
					{/if}
					{#if showPermTree && !permsButtonDisabled && permTreeData}
						<div class="mt-2 rounded-md border border-border bg-card">
							<!-- Server node -->
							<div
								class="relative px-3 py-2 text-xs font-medium hover:bg-accent"
								onpointerenter={() => (hoveredNode = 'server')}
								onpointerleave={() => (hoveredNode = null)}
							>
								<Shield class="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
								Server
								<span class="ml-1 text-[10px] text-muted-foreground">
									({permNamesFromBitmask(permTreeData.server.permissions).length} perms)
								</span>
								{#if hoveredNode === 'server'}
									<div class="absolute left-0 top-full z-50 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
										<div class="flex flex-wrap gap-1">
											{#each permNamesFromBitmask(permTreeData.server.permissions) as p (p)}
												<span class="rounded bg-green-500/15 px-1 py-0.5 text-[9px] text-green-600 dark:text-green-400">{p}</span>
											{/each}
										</div>
									</div>
								{/if}
							</div>

							<!-- Uncategorized channels -->
							{#each permTreeData.uncategorized as ch (ch.id)}
								<div
									class="relative border-t border-border px-3 py-1.5 pl-6 text-xs hover:bg-accent {!ch.can_view ? 'opacity-40 line-through' : ''}"
									onpointerenter={() => (hoveredNode = ch.id)}
									onpointerleave={() => (hoveredNode = null)}
								>
									{#if ch.type === 'voice'}
										<Volume2 class="mr-1 inline h-3 w-3 text-muted-foreground" />
									{:else}
										<Hash class="mr-1 inline h-3 w-3 text-muted-foreground" />
									{/if}
									{ch.name}
									{#if hoveredNode === ch.id}
										<div class="absolute left-0 top-full z-50 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
											<div class="flex flex-wrap gap-1">
												{#each permNamesFromBitmask(ch.permissions) as p (p)}
													<span class="rounded bg-green-500/15 px-1 py-0.5 text-[9px] text-green-600 dark:text-green-400">{p}</span>
												{/each}
												{#if permNamesFromBitmask(ch.permissions).length === 0}
													<span class="text-[9px] text-muted-foreground">No permissions</span>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							{/each}

							<!-- Categories -->
							{#each permTreeData.categories as cat (cat.id)}
								<div
									class="relative border-t border-border px-3 py-1.5 pl-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent"
									onpointerenter={() => (hoveredNode = `cat:${cat.id}`)}
									onpointerleave={() => (hoveredNode = null)}
								>
									<ChevronDown class="mr-0.5 inline h-3 w-3" />
									{cat.name}
									{#if hoveredNode === `cat:${cat.id}`}
										<div class="absolute left-0 top-full z-50 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
											<p class="mb-1 text-[9px] font-normal normal-case">Category-level permissions:</p>
											<div class="flex flex-wrap gap-1">
												{#each permNamesFromBitmask(cat.permissions) as p (p)}
													<span class="rounded bg-green-500/15 px-1 py-0.5 text-[9px] text-green-600 dark:text-green-400">{p}</span>
												{/each}
											</div>
										</div>
									{/if}
								</div>
								{#each cat.channels as ch (ch.id)}
									<div
										class="relative border-t border-border px-3 py-1.5 pl-8 text-xs hover:bg-accent {!ch.can_view ? 'opacity-40 line-through' : ''}"
										onpointerenter={() => (hoveredNode = ch.id)}
										onpointerleave={() => (hoveredNode = null)}
									>
										{#if ch.type === 'voice'}
											<Volume2 class="mr-1 inline h-3 w-3 text-muted-foreground" />
										{:else}
											<Hash class="mr-1 inline h-3 w-3 text-muted-foreground" />
										{/if}
										{ch.name}
										{#if hoveredNode === ch.id}
											<div class="absolute left-0 top-full z-50 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
												<div class="flex flex-wrap gap-1">
													{#each permNamesFromBitmask(ch.permissions) as p (p)}
														<span class="rounded bg-green-500/15 px-1 py-0.5 text-[9px] text-green-600 dark:text-green-400">{p}</span>
													{/each}
													{#if permNamesFromBitmask(ch.permissions).length === 0}
														<span class="text-[9px] text-muted-foreground">No permissions</span>
													{/if}
												</div>
											</div>
										{/if}
									</div>
								{/each}
							{/each}
						</div>
					{:else if showPermTree && permTreeLoading}
						<div class="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
							<Loader2 class="h-3 w-3 animate-spin" /> Loading…
						</div>
					{/if}
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
