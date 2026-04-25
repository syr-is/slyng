<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Copy, Check } from '@lucide/svelte';
	import { api } from '@syren/app-core/api';

	const {
		open,
		serverId,
		onClose
	}: {
		open: boolean;
		serverId: string;
		onClose: () => void;
	} = $props();

	let inviteCode = $state<string | null>(null);
	let loading = $state(false);
	let copied = $state(false);

	const inviteLink = $derived(
		inviteCode ? `${window.location.origin}/invite/${inviteCode}` : ''
	);

	async function createInvite() {
		loading = true;
		try {
			const result = await api.servers.createInvite(serverId);
			inviteCode = result.code;
		} catch {
			// error
		}
		loading = false;
	}

	async function copyLink() {
		if (!inviteLink) return;
		try {
			await navigator.clipboard.writeText(inviteLink);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = inviteLink;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	$effect(() => {
		if (open && !inviteCode) createInvite();
	});
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) { onClose(); inviteCode = null; } }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Invite People</Dialog.Title>
			<Dialog.Description>Share this link to invite people to your server.</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			{#if inviteCode}
				<div class="flex gap-2">
					<Input value={inviteLink} readonly class="font-mono text-xs" />
					<Button variant="outline" size="icon" onclick={copyLink}>
						{#if copied}
							<Check class="h-4 w-4 text-green-500" />
						{:else}
							<Copy class="h-4 w-4" />
						{/if}
					</Button>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">Creating invite...</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => { onClose(); inviteCode = null; }}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
