<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import {
		Ban,
		UserMinus,
		UserPlus,
		Shield,
		ShieldX,
		Trash2,
		Pencil,
		Plus,
		X,
		Ticket,
		MessageSquare,
		Hash,
		Server,
		RotateCcw
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { proxied } from '$lib/utils/proxy';
	import HardDeleteConfirmDialog from './server-settings/hard-delete-confirm-dialog.svelte';

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

	const { row, onChanged }: { row: Row; onChanged?: () => void } = $props();
	const perms = getPerms();
	let confirmHard = $state(false);

	async function restoreMessage() {
		const channelId = row.channel_id ?? ((row.metadata as any)?.channel_id as string | undefined);
		if (!channelId || !row.target_id) {
			toast.error('Missing channel reference for restore');
			return;
		}
		try {
			await api.channels.restoreMessage(channelId, row.target_id);
			toast.success('Message restored');
			onChanged?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to restore');
		}
	}

	async function hardDeleteMessage() {
		const channelId = row.channel_id ?? ((row.metadata as any)?.channel_id as string | undefined);
		if (!channelId || !row.target_id) {
			toast.error('Missing channel reference for delete');
			throw new Error('missing channel');
		}
		try {
			await api.channels.hardDeleteMessage(channelId, row.target_id);
			toast.success('Message deleted forever');
			onChanged?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
			throw err;
		}
	}

	const memberStore = getMembers();
	const actorProfile = $derived(
		resolveProfile(
			row.actor_id,
			memberStore.list.find((m) => m.user_id === row.actor_id)?.syr_instance_url
		)
	);
	const actorName = $derived(displayName(actorProfile, row.actor_id));

	const ACTION_LABELS: Record<string, { label: string; icon: any; tone: string }> = {
		message_delete: { label: 'Deleted a message', icon: Trash2, tone: 'text-destructive' },
		message_purge: { label: 'Purged messages', icon: Trash2, tone: 'text-destructive' },
		message_restore: { label: 'Restored a message', icon: RotateCcw, tone: 'text-green-500' },
		message_hard_delete: { label: 'Permanently deleted a message', icon: Trash2, tone: 'text-destructive' },
		member_kick: { label: 'Kicked member', icon: UserMinus, tone: 'text-amber-500' },
		member_ban: { label: 'Banned member', icon: Ban, tone: 'text-destructive' },
		member_unban: { label: 'Unbanned member', icon: UserPlus, tone: 'text-green-500' },
		member_role_add: { label: 'Added role', icon: Shield, tone: 'text-primary' },
		member_role_remove: { label: 'Removed role', icon: ShieldX, tone: 'text-muted-foreground' },
		role_create: { label: 'Created role', icon: Plus, tone: 'text-primary' },
		role_update: { label: 'Updated role', icon: Pencil, tone: 'text-muted-foreground' },
		role_delete: { label: 'Trashed role', icon: X, tone: 'text-destructive' },
		role_restore: { label: 'Restored role', icon: RotateCcw, tone: 'text-green-500' },
		role_hard_delete: { label: 'Permanently deleted role', icon: Trash2, tone: 'text-destructive' },
		channel_create: { label: 'Created channel', icon: Hash, tone: 'text-primary' },
		channel_update: { label: 'Updated channel', icon: Pencil, tone: 'text-muted-foreground' },
		channel_delete: { label: 'Trashed channel', icon: X, tone: 'text-destructive' },
		channel_restore: { label: 'Restored channel', icon: RotateCcw, tone: 'text-green-500' },
		channel_hard_delete: { label: 'Permanently deleted channel', icon: Trash2, tone: 'text-destructive' },
		server_update: { label: 'Updated server', icon: Server, tone: 'text-muted-foreground' },
		invite_create: { label: 'Created invite', icon: Ticket, tone: 'text-primary' },
		invite_delete: { label: 'Revoked invite', icon: X, tone: 'text-muted-foreground' }
	};

	const meta = $derived(row.metadata ?? {});
	const actionDef = $derived(ACTION_LABELS[row.action] ?? {
		label: row.action,
		icon: MessageSquare,
		tone: 'text-muted-foreground'
	});

	// Resolve target user identity for member_* actions so the row shows
	// *who* was kicked/banned/role-changed, not just the verb.
	const targetUserId = $derived(row.target_user_id ?? null);
	const targetProfile = $derived(
		targetUserId
			? resolveProfile(
					targetUserId,
					memberStore.list.find((m) => m.user_id === targetUserId)?.syr_instance_url
				)
			: null
	);
	const targetName = $derived(
		targetUserId && targetProfile ? displayName(targetProfile, targetUserId) : null
	);

	const MEMBER_ACTIONS = new Set([
		'member_kick',
		'member_ban',
		'member_unban',
		'member_role_add',
		'member_role_remove'
	]);
	const showTargetMember = $derived(MEMBER_ACTIONS.has(row.action) && !!targetUserId);

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

	const Icon = $derived(actionDef.icon);
</script>

<div class="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-xs">
	<div class="shrink-0">
		<div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted {actionDef.tone}">
			<Icon class="h-4 w-4" />
		</div>
	</div>
	<div class="min-w-0 flex-1 space-y-1">
		<div class="flex items-center gap-2">
			<Avatar.Root class="h-5 w-5">
				{#if actorProfile.avatar_url}
					<Avatar.Image src={proxied(actorProfile.avatar_url)} alt={actorName} />
				{/if}
				<Avatar.Fallback class="text-[9px]">
					{actorName.slice(0, 2).toUpperCase()}
				</Avatar.Fallback>
			</Avatar.Root>
			<span class="truncate font-medium">{actorName}</span>
			<span class="text-muted-foreground">·</span>
			<span class="text-muted-foreground" title={new Date(row.created_at).toLocaleString()}>
				{formatAgo(row.created_at)}
			</span>
		</div>
		<div class="font-semibold {actionDef.tone}">
			{actionDef.label}
		</div>

		{#if showTargetMember && targetProfile && targetName}
			<div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<span>→</span>
				<Avatar.Root class="h-4 w-4">
					{#if targetProfile.avatar_url}
						<Avatar.Image src={proxied(targetProfile.avatar_url)} alt={targetName} />
					{/if}
					<Avatar.Fallback class="text-[8px]">
						{targetName.slice(0, 2).toUpperCase()}
					</Avatar.Fallback>
				</Avatar.Root>
				<span class="truncate font-medium text-foreground">{targetName}</span>
				<span class="truncate font-mono text-[10px]">{targetUserId}</span>
			</div>
		{/if}

		<!-- Action-specific detail strip -->
		{#if row.action === 'member_role_add' || row.action === 'member_role_remove'}
			{@const roleName = (meta as any).role_name ?? 'unknown'}
			{@const roleColor = (meta as any).role_color ?? '#99aab5'}
			<span
				class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
				style="background-color: {roleColor}33; color: {roleColor}"
			>
				<span class="h-1.5 w-1.5 rounded-full" style="background-color: {roleColor}"></span>
				{roleName}
			</span>
		{:else if row.action === 'channel_create' || row.action === 'channel_delete' || row.action === 'channel_update'}
			<span class="font-mono text-muted-foreground">#{(meta as any).name ?? row.target_id}</span>
		{:else if row.action === 'invite_create'}
			<span class="font-mono text-muted-foreground">
				{row.target_id} · {(meta as any).target_kind ?? 'open'}
				{#if (meta as any).target_value} · {(meta as any).target_value}{/if}
			</span>
		{:else if row.action === 'invite_delete'}
			<span class="font-mono text-muted-foreground">{row.target_id}</span>
		{:else if row.action === 'message_purge'}
			<span class="text-muted-foreground">
				batch {(row.batch_id ?? '').slice(0, 8) || '—'}
				{#if (meta as any).channel_id}· in channel{/if}
			</span>
		{:else if row.action === 'server_update'}
			{@const changes = Object.keys((meta as any).changes ?? {})}
			{#if changes.length}
				<span class="text-muted-foreground">Fields: {changes.join(', ')}</span>
			{/if}
		{:else if row.action === 'role_update'}
			{@const changes = Object.keys((meta as any).changes ?? {})}
			{#if changes.length}
				<span class="text-muted-foreground">
					{(meta as any).name ?? 'role'} · {changes.join(', ')}
				</span>
			{/if}
		{:else if row.action === 'role_create' || row.action === 'role_delete'}
			<span class="text-muted-foreground">{(meta as any).name ?? 'role'}</span>
		{/if}

		{#if row.reason}
			<p class="text-muted-foreground">Reason: "{row.reason}"</p>
		{/if}

		{#if (row.action === 'message_delete' || row.action === 'message_purge') && perms.canViewRemovedMessages}
			{@const content = (meta as any).message_content as string | undefined}
			{@const atts = ((meta as any).message_attachments as any[] | undefined) ?? []}
			{#if content || atts.length}
				<div class="mt-1 rounded-md border border-border bg-muted/30 p-2 text-xs">
					{#if content}
						<p class="whitespace-pre-wrap break-words text-foreground/90">{content}</p>
					{/if}
					{#if atts.length}
						<p class="mt-1 text-[11px] text-muted-foreground">
							{atts.length} attachment{atts.length === 1 ? '' : 's'}
						</p>
					{/if}
				</div>
			{:else if !content && row.target_id}
				<p class="mt-1 text-[11px] italic text-muted-foreground">
					Message no longer available (hard-deleted).
				</p>
			{/if}
		{/if}

		{#if row.action === 'message_delete' && (perms.canViewTrash || perms.canHardDelete)}
			<div class="flex items-center gap-1 pt-1">
				{#if perms.canViewTrash}
					<button
						type="button"
						onclick={restoreMessage}
						class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Restore message"
					>
						<RotateCcw class="h-3 w-3" />
						Restore
					</button>
				{/if}
				{#if perms.canHardDelete}
					<button
						type="button"
						onclick={() => (confirmHard = true)}
						class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
						title="Delete forever"
					>
						<Trash2 class="h-3 w-3" />
						Delete forever
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if confirmHard}
	<HardDeleteConfirmDialog
		open={true}
		kind="message"
		onConfirm={hardDeleteMessage}
		onClose={() => (confirmHard = false)}
	/>
{/if}
