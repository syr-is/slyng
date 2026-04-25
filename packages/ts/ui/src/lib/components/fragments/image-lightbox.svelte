<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Dialog from '@syren/ui/dialog';
	import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from '@lucide/svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	interface LightboxItem {
		url: string;
		filename: string;
		mime_type: string;
	}

	const {
		open,
		items,
		startIndex = 0,
		onClose
	}: {
		open: boolean;
		items: LightboxItem[];
		startIndex?: number;
		onClose: () => void;
	} = $props();

	let index = $state(startIndex);
	let contain = $state(true);

	$effect(() => {
		if (open) index = startIndex;
	});

	const current = $derived(items[index]);
	const isVideo = $derived(!!current?.mime_type?.startsWith('video/'));

	function prev() {
		if (index > 0) index--;
	}
	function next() {
		if (index < items.length - 1) index++;
	}
	function close() {
		onClose();
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
		else if (e.key === ' ') {
			e.preventDefault();
			contain = !contain;
		}
	}

	onMount(() => window.addEventListener('keydown', onKey));
	onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) close(); }}>
	<Dialog.Content
		showCloseButton={false}
		class="fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black/95 p-0 text-white shadow-none sm:max-w-none"
	>
		{#if current}
			<div class="relative flex h-[100dvh] w-full items-center justify-center">
				<!-- Header -->
				<div
					class="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 px-4 pb-4 pt-6 bg-gradient-to-b from-black/70 to-transparent"
				>
					<p class="min-w-0 flex-1 truncate text-sm text-white/90">{current.filename}</p>
					{#if items.length > 1}
						<span class="text-xs text-white/60">{index + 1} / {items.length}</span>
					{/if}
					<button
						type="button"
						class="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
						onclick={() => (contain = !contain)}
						title={contain ? 'Fill screen' : 'Fit to screen'}
					>
						{#if contain}
							<Maximize2 class="h-4 w-4" />
						{:else}
							<Minimize2 class="h-4 w-4" />
						{/if}
					</button>
					<button
						type="button"
						class="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
						onclick={close}
						title="Close"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<div class="flex h-full w-full items-center justify-center p-4">
					{#if isVideo}
						<video
							src={proxied(current.url)}
							class="rounded-lg {contain ? 'max-h-full max-w-full object-contain' : 'h-full w-full object-cover'}"
							controls
							autoplay
							playsinline
						>
							<track kind="captions" label="Captions unavailable" />
						</video>
					{:else}
						<img
							src={proxied(current.url)}
							alt={current.filename}
							class="rounded-lg {contain ? 'max-h-full max-w-full object-contain' : 'h-full w-full object-cover'}"
							draggable={false}
						/>
					{/if}
				</div>

				{#if index > 0}
					<button
						type="button"
						class="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white"
						onclick={prev}
						aria-label="Previous"
					>
						<ChevronLeft class="h-6 w-6" />
					</button>
				{/if}
				{#if index < items.length - 1}
					<button
						type="button"
						class="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white"
						onclick={next}
						aria-label="Next"
					>
						<ChevronRight class="h-6 w-6" />
					</button>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
