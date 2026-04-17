<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';

	const {
		open,
		serverId,
		targetUserId,
		targetName,
		onClose,
		onDone
	}: {
		open: boolean;
		serverId: string;
		targetUserId: string;
		targetName: string;
		onClose: () => void;
		onDone?: () => void;
	} = $props();

	const DELETE_OPTIONS: { label: string; seconds: number }[] = [
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

	let deleteSeconds = $state('3600');
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			deleteSeconds = '3600';
			submitting = false;
		}
	});

	async function submit() {
		const secs = parseInt(deleteSeconds, 10);
		if (!Number.isFinite(secs) || secs <= 0) return;
		submitting = true;
		try {
			await api.servers.purgeMemberMessages(serverId, targetUserId, { delete_seconds: secs });
			toast.success('Messages purged');
			onDone?.();
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Purge failed');
		}
		submitting = false;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Trash2 class="h-5 w-5 text-destructive" />
				Delete messages
			</Dialog.Title>
			<Dialog.Description>
				Permanently remove <span class="font-medium text-foreground">{targetName}</span>'s messages in this server within the selected window. No kick or ban.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2 py-2">
			<label for="purge-window" class="text-xs text-muted-foreground">Delete window</label>
			<select
				id="purge-window"
				bind:value={deleteSeconds}
				class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
			>
				{#each DELETE_OPTIONS as opt (opt.seconds)}
					<option value={String(opt.seconds)}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
			<Button variant="destructive" disabled={submitting} onclick={submit}>
				{submitting ? 'Deleting…' : 'Delete messages'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
