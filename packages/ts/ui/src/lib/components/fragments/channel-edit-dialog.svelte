<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';

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

	$effect(() => {
		if (open) {
			name = channelName;
			topic = channelTopic ?? '';
		}
	});

	async function save() {
		if (!name.trim()) return;
		saving = true;
		try {
			await api.channels.update(channelId, { name: name.trim(), topic: topic.trim() || undefined });
			onUpdated();
			toast.success('Channel updated');
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update');
		}
		saving = false;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
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
			<Button variant="outline" onclick={onClose}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
