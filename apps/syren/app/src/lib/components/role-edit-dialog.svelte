<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { toast } from 'svelte-sonner';
	import { Permissions } from '@syren/types';
	import { api } from '$lib/api';

	type Role = {
		id?: string;
		name: string;
		color: string | null;
		permissions: string;
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
		{ key: 'ADMINISTRATOR', label: 'Administrator (bypasses all checks)', group: 'General' },
		{ key: 'MANAGE_SERVER', label: 'Manage Server', group: 'General' },
		{ key: 'MANAGE_ROLES', label: 'Manage Roles', group: 'General' },
		{ key: 'MANAGE_CHANNELS', label: 'Manage Channels', group: 'General' },
		{ key: 'KICK_MEMBERS', label: 'Kick Members', group: 'Membership' },
		{ key: 'BAN_MEMBERS', label: 'Ban Members', group: 'Membership' },
		{ key: 'CREATE_INVITES', label: 'Create Invites', group: 'Invites' },
		{ key: 'MANAGE_INVITES', label: 'Manage Invites (list + revoke any)', group: 'Invites' },
		{ key: 'VIEW_AUDIT_LOG', label: 'View Audit Log', group: 'Moderation' },
		{ key: 'VIEW_REMOVED_MESSAGES', label: 'View Removed Messages (read content of soft-deleted messages)', group: 'Moderation' },
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

	const groups = ['General', 'Membership', 'Moderation', 'Invites', 'Text', 'Voice'];

	let name = $state(role?.name ?? '');
	let color = $state(role?.color ?? '#99aab5');
	let perms = $state(BigInt(role?.permissions ?? '0'));
	let saving = $state(false);

	$effect(() => {
		if (open) {
			name = role?.name ?? '';
			color = role?.color ?? '#99aab5';
			perms = BigInt(role?.permissions ?? '0');
		}
	});

	function isOn(flag: bigint): boolean {
		return (perms & flag) === flag;
	}

	function toggle(flag: bigint) {
		if (isOn(flag)) {
			perms = perms & ~flag;
		} else {
			perms = perms | flag;
		}
	}

	async function save() {
		if (!name.trim()) return;
		saving = true;
		try {
			if (role?.id) {
				const patch: { name?: string; color: string; permissions: string } = {
					color,
					permissions: perms.toString()
				};
				// Default role's name is immutable — don't send it
				if (!role.is_default) patch.name = name.trim();
				await api.roles.update(role.id, patch);
				toast.success('Role updated');
			} else {
				await api.roles.create(serverId, {
					name: name.trim(),
					color,
					permissions: perms.toString()
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
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{role?.id ? 'Edit Role' : 'Create Role'}</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="role-name" class="text-sm font-medium">Name</label>
				<Input
					id="role-name"
					bind:value={name}
					placeholder="e.g. moderator"
					disabled={role?.is_default}
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
					class="h-9 w-16 cursor-pointer rounded-md border border-input bg-background p-1"
				/>
			</div>

			<div class="space-y-3">
				<p class="text-sm font-medium">Permissions</p>
				<div class="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-3">
					{#each groups as group}
						<div class="space-y-1">
							<p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
							{#each PERM_LIST.filter((p) => p.group === group) as p}
								<label class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent">
									<input
										type="checkbox"
										checked={isOn(Permissions[p.key])}
										onchange={() => toggle(Permissions[p.key])}
										class="h-4 w-4 rounded border-input"
									/>
									<span class="text-sm text-foreground">{p.label}</span>
								</label>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button onclick={save} disabled={saving || !name.trim()}>
				{saving ? 'Saving...' : role?.id ? 'Save' : 'Create'}
			</Button>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
