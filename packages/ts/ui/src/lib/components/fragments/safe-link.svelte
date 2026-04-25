<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { ExternalLink, TriangleAlert } from '@lucide/svelte';
	import { originHost } from '@syren/app-core/utils/proxy';
	import { isTrusted, addTrustedDomain } from '@syren/app-core/stores/trusted-domains.svelte';

	const {
		href,
		class: className = 'text-primary hover:underline',
		children
	}: {
		href: string;
		class?: string;
		children: Snippet;
	} = $props();

	let confirmOpen = $state(false);
	let trustDomain = $state(false);

	const host = $derived(originHost(href));

	function openConfirm(e: MouseEvent | KeyboardEvent) {
		e.preventDefault();
		if (isTrusted(host)) {
			window.open(href, '_blank', 'noopener,noreferrer');
			return;
		}
		trustDomain = false;
		confirmOpen = true;
	}

	function proceed() {
		if (trustDomain && host) {
			addTrustedDomain(host);
		}
		try {
			window.open(href, '_blank', 'noopener,noreferrer');
		} finally {
			confirmOpen = false;
		}
	}
</script>

<a
	{href}
	rel="noopener noreferrer"
	target="_blank"
	class={className}
	onclick={openConfirm}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') openConfirm(e);
	}}
>
	{@render children()}
</a>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<TriangleAlert class="h-5 w-5 text-amber-500" />
				Leaving syren
			</Dialog.Title>
			<Dialog.Description>
				You're about to visit an external site. syren can't vouch for what happens
				there.
			</Dialog.Description>
		</Dialog.Header>
		<div class="my-2 break-all rounded-md border border-border bg-muted/40 p-3 text-xs">
			<p class="font-mono text-foreground">{href}</p>
			<p class="mt-1 text-muted-foreground">Host: <span class="font-mono">{host}</span></p>
		</div>
		<label class="flex items-center gap-2 text-sm text-muted-foreground">
			<input type="checkbox" bind:checked={trustDomain} class="rounded border-border" />
			Always trust <span class="font-mono">{host}</span>
		</label>
		<Dialog.Footer class="gap-2 sm:gap-2">
			<Button variant="outline" onclick={() => (confirmOpen = false)}>Cancel</Button>
			<Button onclick={proceed}>
				<ExternalLink class="mr-1.5 h-4 w-4" />
				Continue
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
