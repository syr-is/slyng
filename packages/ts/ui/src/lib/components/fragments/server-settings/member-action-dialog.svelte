<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { UserMinus, Ban } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';

	type Kind = 'kick' | 'ban';

	const {
		open,
		kind,
		serverId,
		targetUserId,
		targetName,
		onClose,
		onDone
	}: {
		open: boolean;
		kind: Kind;
		serverId: string;
		targetUserId: string;
		targetName: string;
		onClose: () => void;
		onDone: () => void;
	} = $props();

	const DELETE_OPTIONS: { label: string; seconds: number }[] = [
		{ label: "Don't delete any", seconds: 0 },
		{ label: 'Previous 1 hour', seconds: 3600 },
		{ label: 'Previous 3 hours', seconds: 10800 },
		{ label: 'Previous 5 hours', seconds: 18000 },
		{ label: 'Previous 12 hours', seconds: 43200 },
		{ label: 'Previous 24 hours', seconds: 86400 },
		{ label: 'Previous 3 days', seconds: 259200 },
		{ label: 'Previous 7 days', seconds: 604800 },
		{ label: 'Previous 14 days', seconds: 1209600 },
		{ label: 'Previous 30 days', seconds: 2592000 },
		{ label: 'All messages (ever)', seconds: Number.MAX_SAFE_INTEGER }
	];

	let deleteSeconds = $state('0');
	let reason = $state('');
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			deleteSeconds = '0';
			reason = '';
			submitting = false;
		}
	});

	async function submit() {
		submitting = true;
		const secs = parseInt(deleteSeconds, 10);
		try {
			if (kind === 'kick') {
				await api.servers.kickMember(serverId, targetUserId, {
					delete_seconds: secs > 0 ? secs : undefined
				});
				toast.success('Member kicked');
			} else {
				await api.servers.banMember(serverId, {
					user_id: targetUserId,
					reason: reason.trim() || undefined,
					delete_seconds: secs > 0 ? secs : undefined
				});
				toast.success('Member banned');
			}
			onDone();
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : `Failed to ${kind}`);
		}
		submitting = false;
	}

	const title = $derived(kind === 'kick' ? 'Kick member' : 'Ban member');
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{#if kind === 'kick'}
					<UserMinus class="h-5 w-5 text-muted-foreground" />
				{:else}
					<Ban class="h-5 w-5 text-destructive" />
				{/if}
				{title}
			</Dialog.Title>
			<Dialog.Description>
				{#if kind === 'kick'}
					Remove <span class="font-medium text-foreground">{targetName}</span> from the server. They can rejoin with a new invite.
				{:else}
					Ban <span class="font-medium text-foreground">{targetName}</span> from the server. They won't be able to rejoin until unbanned.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			{#if kind === 'ban'}
				<div class="space-y-1">
					<label for="ban-reason" class="text-xs text-muted-foreground">Reason (optional)</label>
					<Input id="ban-reason" bind:value={reason} placeholder="spam, harassment, etc." />
				</div>
			{/if}

			<div class="space-y-1">
				<label for="delete-window" class="text-xs text-muted-foreground">
					Delete message history
				</label>
				<select
					id="delete-window"
					bind:value={deleteSeconds}
					class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
				>
					{#each DELETE_OPTIONS as opt (opt.seconds)}
						<option value={String(opt.seconds)}>{opt.label}</option>
					{/each}
				</select>
				<p class="text-[11px] text-muted-foreground">
					Permanently removes this user's messages in the selected window across every channel in the server.
				</p>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
			<Button variant="destructive" disabled={submitting} onclick={submit}>
				{submitting ? 'Working…' : kind === 'kick' ? 'Kick' : 'Ban'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
