<script lang="ts">
	import { Button } from '@syren/ui/button';
	import { Upload, Cloud, X, Loader2, ImageIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { uploadFile, type Attachment } from '$lib/upload/upload-client';
	import { proxied } from '$lib/utils/proxy';
	import SyrUploadPicker from './syr-upload-picker.svelte';

	const {
		value,
		onChange,
		label,
		aspect = 'square'
	}: {
		value: string | null | undefined;
		onChange: (url: string | null) => void;
		label: string;
		aspect?: 'square' | 'wide' | 'banner';
	} = $props();

	let uploading = $state(false);
	let progress = $state(0);
	let showPicker = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	const previewClass = $derived(
		aspect === 'square'
			? 'aspect-square w-24'
			: aspect === 'banner'
				? 'aspect-[5/1] w-full'
				: 'aspect-[3/1] w-full'
	);

	async function handlePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			toast.error('Pick an image file');
			return;
		}
		uploading = true;
		progress = 0;
		try {
			const handle = uploadFile(file, { onProgress: (p) => (progress = p) });
			const attachment = await handle.promise;
			onChange(attachment.url);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		}
		uploading = false;
	}

	function handleSyrPicked(attachment: Attachment) {
		if (!attachment.mime_type.startsWith('image/')) {
			toast.error('Pick an image');
			return;
		}
		onChange(attachment.url);
	}
</script>

{#snippet preview()}
	<div class="overflow-hidden rounded-md border border-border bg-muted {previewClass} shrink-0">
		{#if uploading}
			<div class="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
				<Loader2 class="h-5 w-5 animate-spin" />
				<span class="text-[10px]">{Math.round(progress * 100)}%</span>
			</div>
		{:else if value}
			<img src={proxied(value)} alt={label} class="h-full w-full object-cover" />
		{:else}
			<div class="flex h-full w-full items-center justify-center text-muted-foreground/50">
				<ImageIcon class="h-6 w-6" />
			</div>
		{/if}
	</div>
{/snippet}

{#snippet controls()}
	<input
		type="file"
		accept="image/*"
		class="hidden"
		bind:this={fileInput}
		onchange={handlePick}
	/>
	<Button type="button" size="sm" variant="outline" disabled={uploading} onclick={() => fileInput?.click()}>
		<Upload class="mr-1.5 h-3.5 w-3.5" />
		Upload
	</Button>
	<Button type="button" size="sm" variant="outline" disabled={uploading} onclick={() => (showPicker = true)}>
		<Cloud class="mr-1.5 h-3.5 w-3.5" />
		From syr
	</Button>
	{#if value}
		<Button type="button" size="sm" variant="ghost" class="text-destructive" onclick={() => onChange(null)}>
			<X class="mr-1.5 h-3.5 w-3.5" />
			Remove
		</Button>
	{/if}
{/snippet}

<div class="space-y-2">
	<p class="text-sm font-medium">{label}</p>
	{#if aspect === 'square'}
		<div class="flex items-start gap-3">
			{@render preview()}
			<div class="flex flex-col items-stretch gap-2">
				{@render controls()}
			</div>
		</div>
	{:else}
		<div class="space-y-2">
			{@render preview()}
			<div class="flex flex-wrap gap-2">
				{@render controls()}
			</div>
		</div>
	{/if}
</div>

{#if showPicker}
	<SyrUploadPicker
		open={true}
		onPick={handleSyrPicked}
		onClose={() => (showPicker = false)}
	/>
{/if}
