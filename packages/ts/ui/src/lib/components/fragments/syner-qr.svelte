<script lang="ts">
	import QRCode from 'qrcode';
	import { Loader2, Smartphone } from '@lucide/svelte';

	/**
	 * Syner device-signing prompt (P10): renders the `syr://…` deep link as a
	 * scannable QR + an "Open in Syner" button. The signing device (a Syner app
	 * holding the root key) reads the deep link, signs the delegation
	 * statement, and posts it back. The parent drives the mint + status poll.
	 */
	let {
		deeplinkUrl,
		delegateKey = undefined,
		waiting = true
	}: { deeplinkUrl: string; delegateKey?: string; waiting?: boolean } = $props();

	let qrDataUrl = $state<string | null>(null);
	let qrError = $state(false);

	$effect(() => {
		const url = deeplinkUrl;
		qrError = false;
		qrDataUrl = null;
		QRCode.toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
			.then((d) => {
				// Guard against a stale resolution after deeplinkUrl changed.
				if (url === deeplinkUrl) qrDataUrl = d;
			})
			.catch(() => {
				qrError = true;
			});
	});
</script>

<div class="flex flex-col items-center gap-3">
	<div class="rounded-lg border border-border bg-white p-2">
		{#if qrDataUrl}
			<img src={qrDataUrl} alt="Scan with your Syner device" width="220" height="220" class="h-auto max-w-full" />
		{:else if qrError}
			<div class="flex size-[220px] items-center justify-center text-center text-xs text-muted-foreground">
				Could not render QR — use the button below.
			</div>
		{:else}
			<div class="flex size-[220px] items-center justify-center">
				<Loader2 class="size-6 animate-spin text-muted-foreground" />
			</div>
		{/if}
	</div>

	<a
		href={deeplinkUrl}
		class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
	>
		<Smartphone class="size-4" /> Open in Syner
	</a>

	{#if delegateKey}
		<p class="max-w-[240px] truncate font-mono text-[10px] text-muted-foreground" title={delegateKey}>
			key: {delegateKey}
		</p>
	{/if}

	{#if waiting}
		<p class="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
			<Loader2 class="size-4 animate-spin" /> Waiting for your device to approve…
		</p>
	{/if}
</div>
