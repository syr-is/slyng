<script lang="ts">
	import * as Dialog from '@slyng/ui/dialog';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { toast } from 'svelte-sonner';
	import { api } from '@slyng/app-core/api';
	import { createDirtyGuard } from '@slyng/app-core/stores/dirty-guard.svelte';
	import DiscardChangesDialog from './discard-changes-dialog.svelte';

	const {
		open,
		channelId,
		channelName,
		channelTopic,
		onClose,
		onUpdated
	}: {
		open: boolean;
		channelId: string;
		channelName: string;
		channelTopic: string;
		onClose: () => void;
		onUpdated: () => void;
	} = $props();

	let name = $state(channelName);
	let topic = $state(channelTopic ?? '');
	let saving = $state(false);

	// Unsaved-changes guard — closing with edits interposes a discard
	// confirm instead of silently dropping them.
	const dirtyGuard = createDirtyGuard(() => ({ name, topic }));
	// bits-ui closes internally before we can veto, so mirror `open` into
	// bindable local state and flip it back when the close is intercepted.
	// Capturing the initial value is intentional — the $effect below keeps
	// it in sync whenever the parent re-opens.
	// svelte-ignore state_referenced_locally
	let dialogOpen = $state(open);
	let showDiscardConfirm = $state(false);

	$effect(() => {
		if (open) {
			name = channelName;
			topic = channelTopic ?? '';
			dialogOpen = true;
			showDiscardConfirm = false;
			dirtyGuard.capture();
		}
	});

	function requestClose() {
		if (dirtyGuard.dirty) {
			dialogOpen = true; // veto the close — keep the editor visible underneath
			showDiscardConfirm = true;
			return;
		}
		onClose();
	}

	async function save() {
		if (!name.trim()) return;
		saving = true;
		try {
			await api.channels.update(channelId, { name: name.trim(), topic: topic.trim() || undefined });
			onUpdated();
			toast.success('Channel updated');
			dirtyGuard.capture();
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update');
		}
		saving = false;
	}
</script>

<Dialog.Root bind:open={dialogOpen} onOpenChange={(v) => { if (!v) requestClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Edit Channel</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="ch-name" class="text-sm font-medium">Channel Name</label>
				<Input id="ch-name" bind:value={name} />
			</div>
			<div class="space-y-2">
				<label for="ch-topic" class="text-sm font-medium">Topic</label>
				<Input id="ch-topic" bind:value={topic} placeholder="What's this channel about?" />
			</div>
		</div>
		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button onclick={save} disabled={saving || !name.trim()}>
				{saving ? 'Saving...' : 'Save'}
			</Button>
			<Button variant="outline" onclick={requestClose}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<DiscardChangesDialog
	open={showDiscardConfirm}
	title={`Discard changes to #${channelName}?`}
	description="Your unsaved edits to this channel's name and topic will be lost."
	onKeepEditing={() => (showDiscardConfirm = false)}
	onDiscard={() => {
		showDiscardConfirm = false;
		onClose();
	}}
/>
