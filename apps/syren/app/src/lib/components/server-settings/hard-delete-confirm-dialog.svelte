<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { AlertTriangle } from '@lucide/svelte';

	const {
		open,
		kind,
		name,
		count,
		onConfirm,
		onClose
	}: {
		open: boolean;
		kind: 'channel' | 'role' | 'message';
		name?: string;
		count?: number;
		onConfirm: () => Promise<void> | void;
		onClose: () => void;
	} = $props();

	let typed = $state('');
	let submitting = $state(false);
	const requiresType = $derived(kind !== 'message' && !!name);
	const matches = $derived(!requiresType || typed.trim() === (name ?? '').trim());

	$effect(() => {
		if (open) {
			typed = '';
			submitting = false;
		}
	});

	async function confirm() {
		if (!matches || submitting) return;
		submitting = true;
		try {
			await onConfirm();
			onClose();
		} catch {
			// onConfirm should toast its own error; just re-enable the button
			submitting = false;
		}
	}

	const headline = $derived(
		kind === 'channel'
			? `Permanently delete #${name ?? 'channel'}?`
			: kind === 'role'
				? `Permanently delete role "${name ?? ''}"?`
				: 'Permanently delete this message?'
	);

	const blurb = $derived(
		kind === 'channel'
			? count != null && count > 0
				? `This will erase ${count} message${count === 1 ? '' : 's'}, every reaction, every pin, and every read receipt in this channel. There is no undo.`
				: 'This will erase the channel and any remaining attachments. There is no undo.'
			: kind === 'role'
				? count != null && count > 0
					? `This will permanently strip the role from ${count} member${count === 1 ? '' : 's'} and remove it forever. There is no undo.`
					: 'This will permanently remove the role. There is no undo.'
				: 'The message and all reactions and pins on it will be erased. There is no undo.'
	);
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<AlertTriangle class="h-5 w-5" />
				{headline}
			</Dialog.Title>
			<Dialog.Description>
				{blurb}
			</Dialog.Description>
		</Dialog.Header>

		{#if requiresType}
			<div class="space-y-2 py-2">
				<label for="hard-delete-confirm" class="text-xs text-muted-foreground">
					Type <span class="font-mono text-foreground">{name}</span> to confirm
				</label>
				<Input id="hard-delete-confirm" bind:value={typed} placeholder={name} autocomplete="off" />
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={!matches || submitting}
				onclick={confirm}
			>
				{submitting ? 'Deleting…' : 'Delete forever'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
