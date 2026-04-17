<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import ImageField from './image-field.svelte';

	const {
		open,
		onClose,
		onCreate
	}: {
		open: boolean;
		onClose: () => void;
		onCreate: (data: {
			name: string;
			icon_url?: string;
			banner_url?: string;
			invite_background_url?: string;
			description?: string;
		}) => void;
	} = $props();

	let name = $state('');
	let description = $state('');
	let iconUrl = $state<string | null>(null);
	let bannerUrl = $state<string | null>(null);
	let inviteBgUrl = $state<string | null>(null);

	function reset() {
		name = '';
		description = '';
		iconUrl = null;
		bannerUrl = null;
		inviteBgUrl = null;
	}

	function submit() {
		if (!name.trim()) return;
		onCreate({
			name: name.trim(),
			icon_url: iconUrl ?? undefined,
			banner_url: bannerUrl ?? undefined,
			invite_background_url: inviteBgUrl ?? undefined,
			description: description.trim() || undefined
		});
		reset();
		onClose();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Create a Server</Dialog.Title>
			<Dialog.Description>
				Your server is where you and your friends hang out. Customize its look below.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="server-name" class="text-sm font-medium">Server Name</label>
				<Input
					id="server-name"
					bind:value={name}
					placeholder="My Server"
					onkeydown={(e) => { if (e.key === 'Enter') submit(); }}
				/>
			</div>
			<div class="space-y-2">
				<label for="server-desc" class="text-sm font-medium">Description</label>
				<Input id="server-desc" bind:value={description} placeholder="What's this server about?" />
			</div>
			<ImageField label="Icon" value={iconUrl} onChange={(v) => (iconUrl = v)} aspect="square" />
			<ImageField label="Banner" value={bannerUrl} onChange={(v) => (bannerUrl = v)} aspect="banner" />
			<ImageField
				label="Invite page background"
				value={inviteBgUrl}
				onChange={(v) => (inviteBgUrl = v)}
				aspect="wide"
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
			<Button onclick={submit} disabled={!name.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
