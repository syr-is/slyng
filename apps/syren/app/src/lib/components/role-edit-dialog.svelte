<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Check, Minus, X, Lock } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Permissions } from '@syren/types';
	import { api } from '$lib/api';
	import { getPerms } from '$lib/stores/perms.svelte';

	type Role = {
		id?: string;
		name: string;
		color: string | null;
		position?: number;
		permissions?: string;
		permissions_allow?: string;
		permissions_deny?: string;
		is_default?: boolean;
	};

	const {
		open,
		serverId,
		role,
		onClose,
		onSaved
	}: {
		open: boolean;
		serverId: string;
		role: Role | null; // null = create new
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	const PERM_LIST: { key: keyof typeof Permissions; label: string; group: string }[] = [
		{ key: 'ADMINISTRATOR', label: 'Administrator (bypasses all checks except hierarchy)', group: 'General' },
		{ key: 'MANAGE_SERVER', label: 'Manage Server', group: 'General' },
		{ key: 'MANAGE_ROLES', label: 'Manage Roles', group: 'General' },
		{ key: 'MANAGE_CHANNELS', label: 'Manage Channels', group: 'General' },
		{ key: 'KICK_MEMBERS', label: 'Kick Members', group: 'Membership' },
		{ key: 'BAN_MEMBERS', label: 'Ban Members', group: 'Membership' },
		{ key: 'CREATE_INVITES', label: 'Create Invites', group: 'Invites' },
		{ key: 'MANAGE_INVITES', label: 'Manage Invites (list + revoke any)', group: 'Invites' },
		{ key: 'VIEW_AUDIT_LOG', label: 'View Audit Log', group: 'Moderation' },
		{ key: 'VIEW_REMOVED_MESSAGES', label: 'View Removed Messages (read content of soft-deleted messages)', group: 'Moderation' },
		{ key: 'VIEW_TRASH', label: 'View Trash (browse + restore deleted channels, roles, messages)', group: 'Trash' },
		{ key: 'HARD_DELETE', label: 'Hard Delete (permanently purge trashed items — irreversible)', group: 'Trash' },
		{ key: 'SEND_MESSAGES', label: 'Send Messages', group: 'Text' },
		{ key: 'READ_MESSAGES', label: 'Read Messages', group: 'Text' },
		{ key: 'MANAGE_MESSAGES', label: 'Manage Messages (delete/pin others)', group: 'Text' },
		{ key: 'EMBED_LINKS', label: 'Embed Links', group: 'Text' },
		{ key: 'ATTACH_FILES', label: 'Attach Files', group: 'Text' },
		{ key: 'ADD_REACTIONS', label: 'Add Reactions', group: 'Text' },
		{ key: 'MENTION_EVERYONE', label: 'Mention @everyone', group: 'Text' },
		{ key: 'CONNECT', label: 'Connect to Voice', group: 'Voice' },
		{ key: 'SPEAK', label: 'Speak', group: 'Voice' },
		{ key: 'MUTE_MEMBERS', label: 'Mute Members', group: 'Voice' },
		{ key: 'DEAFEN_MEMBERS', label: 'Deafen Members', group: 'Voice' }
	];

	const groups = ['General', 'Membership', 'Moderation', 'Trash', 'Invites', 'Text', 'Voice'];

	const perms = getPerms();

	// Read-only when the role outranks the actor (or equals their highest).
	// Owner bypasses; same-position rule = strictly below for management.
	const readOnly = $derived(!!role && !perms.canManageRole(role));

	let name = $state(role?.name ?? '');
	let color = $state(role?.color ?? '#99aab5');
	let allow = $state<bigint>(BigInt(role?.permissions_allow ?? role?.permissions ?? '0'));
	let deny = $state<bigint>(BigInt(role?.permissions_deny ?? '0'));
	let saving = $state(false);

	$effect(() => {
		if (open) {
			name = role?.name ?? '';
			color = role?.color ?? '#99aab5';
			allow = BigInt(role?.permissions_allow ?? role?.permissions ?? '0');
			deny = BigInt(role?.permissions_deny ?? '0');
			saving = false;
		}
	});

	function stateOf(flag: bigint): 'allow' | 'deny' | 'unset' {
		if ((allow & flag) === flag) return 'allow';
		if ((deny & flag) === flag) return 'deny';
		return 'unset';
	}

	function setState(flag: bigint, next: 'allow' | 'deny' | 'unset') {
		// Mutually exclusive — clear from the other bag before setting.
		allow = allow & ~flag;
		deny = deny & ~flag;
		if (next === 'allow') allow = allow | flag;
		else if (next === 'deny') deny = deny | flag;
	}

	/**
	 * True if the actor doesn't hold this permission themselves AND isn't the
	 * owner. Disabled rows render with locked icons and don't let the user
	 * flip the state. Backend enforces the same rule.
	 */
	function rowDisabled(flag: bigint): boolean {
		if (perms.isOwner) return false;
		return (perms.bits & flag) !== flag;
	}

	async function save() {
		if (!name.trim() || readOnly) return;
		saving = true;
		try {
			if (role?.id) {
				const patch: {
					name?: string;
					color: string;
					permissions_allow: string;
					permissions_deny: string;
				} = {
					color,
					permissions_allow: allow.toString(),
					permissions_deny: deny.toString()
				};
				if (!role.is_default) patch.name = name.trim();
				await api.roles.update(role.id, patch);
				toast.success('Role updated');
			} else {
				await api.roles.create(serverId, {
					name: name.trim(),
					color,
					permissions_allow: allow.toString(),
					permissions_deny: deny.toString()
				});
				toast.success('Role created');
			}
			onSaved();
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		saving = false;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{role?.id ? 'Edit Role' : 'Create Role'}
				{#if readOnly}
					<span class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
						<Lock class="h-3 w-3" />
						Read-only — above your highest role
					</span>
				{/if}
			</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="role-name" class="text-sm font-medium">Name</label>
				<Input
					id="role-name"
					bind:value={name}
					placeholder="e.g. moderator"
					disabled={role?.is_default || readOnly}
				/>
				{#if role?.is_default}
					<p class="text-xs text-muted-foreground">The default role cannot be renamed.</p>
				{/if}
			</div>
			<div class="space-y-2">
				<label for="role-color" class="text-sm font-medium">Color</label>
				<input
					id="role-color"
					type="color"
					bind:value={color}
					disabled={readOnly}
					class="h-9 w-16 cursor-pointer rounded-md border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
				/>
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium">Permissions</p>
					<div class="flex items-center gap-3 text-[10px] text-muted-foreground">
						<span class="inline-flex items-center gap-1"><Minus class="h-3 w-3" /> Inherit</span>
						<span class="inline-flex items-center gap-1 text-green-500"><Check class="h-3 w-3" /> Allow</span>
						<span class="inline-flex items-center gap-1 text-destructive"><X class="h-3 w-3" /> Deny</span>
					</div>
				</div>
				<div class="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border border-border p-3">
					{#each groups as group}
						<div class="space-y-1">
							<p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
							{#each PERM_LIST.filter((p) => p.group === group) as p}
								{@const flag = Permissions[p.key]}
								{@const cur = stateOf(flag)}
								{@const disabled = readOnly || rowDisabled(flag)}
								<div class="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-accent/40">
									<span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
										{p.label}
										{#if rowDisabled(flag) && !readOnly}
											<Lock class="h-3 w-3 shrink-0 text-muted-foreground" />
										{/if}
									</span>
									<div class="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
										<button
											type="button"
											{disabled}
											onclick={() => setState(flag, 'deny')}
											title="Deny"
											class="flex h-7 w-8 items-center justify-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40
												{cur === 'deny'
												? 'bg-destructive text-destructive-foreground'
												: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'}"
										>
											<X class="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											{disabled}
											onclick={() => setState(flag, 'unset')}
											title="Inherit (no override)"
											class="flex h-7 w-8 items-center justify-center text-xs transition-colors border-x border-border disabled:cursor-not-allowed disabled:opacity-40
												{cur === 'unset'
												? 'bg-muted text-foreground'
												: 'text-muted-foreground hover:bg-muted/50'}"
										>
											<Minus class="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											{disabled}
											onclick={() => setState(flag, 'allow')}
											title="Allow"
											class="flex h-7 w-8 items-center justify-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40
												{cur === 'allow'
												? 'bg-green-600 text-white'
												: 'text-muted-foreground hover:bg-green-500/10 hover:text-green-500'}"
										>
											<Check class="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			{#if !readOnly}
				<Button onclick={save} disabled={saving || !name.trim()}>
					{saving ? 'Saving...' : role?.id ? 'Save' : 'Create'}
				</Button>
			{/if}
			<Button variant="outline" onclick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
