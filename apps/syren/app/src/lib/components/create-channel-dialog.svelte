<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';

	const {
		open,
		onClose,
		onCreate
	}: {
		open: boolean;
		onClose: () => void;
		onCreate: (name: string, type: string) => void;
	} = $props();

	let name = $state('');
	let type = $state<'text' | 'voice'>('text');

	function submit() {
		if (!name.trim()) return;
		onCreate(name.trim(), type);
		name = '';
		type = 'text';
		onClose();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Channel</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="flex gap-2">
				<button
					onclick={() => (type = 'text')}
					class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors
						{type === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}"
				>
					# Text
				</button>
				<button
					onclick={() => (type = 'voice')}
					class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors
						{type === 'voice' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}"
				>
					🔊 Voice
				</button>
			</div>
			<div class="space-y-2">
				<label for="channel-name" class="text-sm font-medium">Channel Name</label>
				<Input
					id="channel-name"
					bind:value={name}
					placeholder={type === 'text' ? 'general' : 'voice-chat'}
					onkeydown={(e) => { if (e.key === 'Enter') submit(); }}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
			<Button onclick={submit} disabled={!name.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
