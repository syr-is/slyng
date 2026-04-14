<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { resolveGifs, type GifEntry } from '$lib/stores/gifs.svelte';
	import { proxied } from '$lib/utils/proxy';

	const {
		onSelect,
		onClose
	}: {
		onSelect: (gif: { url: string; size?: number; mime_type?: string }) => void;
		onClose: () => void;
	} = $props();

	const auth = getAuth();
	const myDid = $derived(auth.identity?.did ?? '');
	const myInstance = $derived(auth.identity?.syr_instance_url);

	let query = $state('');
	let debouncedQuery = $state('');
	let debounceHandle: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const q = query;
		if (debounceHandle) clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => {
			debouncedQuery = q;
		}, 300);
		return () => {
			if (debounceHandle) clearTimeout(debounceHandle);
		};
	});

	const bundle = $derived(myDid ? resolveGifs(myDid, myInstance, debouncedQuery) : null);

	function pick(gif: GifEntry) {
		onSelect({ url: gif.url, size: gif.size, mime_type: gif.mime_type ?? 'image/gif' });
	}
</script>

<div class="w-80 rounded-lg border border-border bg-card shadow-lg">
	<div class="flex items-center justify-between border-b border-border px-3 py-2">
		<span class="text-sm font-semibold">GIFs</span>
		<button
			onclick={onClose}
			class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			title="Close"
		>
			<X class="h-4 w-4" />
		</button>
	</div>

	<div class="border-b border-border p-2">
		<div class="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
			<Search class="h-4 w-4 text-muted-foreground" />
			<input
				type="text"
				bind:value={query}
				placeholder="Search GIFs..."
				class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
			/>
		</div>
	</div>

	<div class="max-h-72 overflow-y-auto p-2">
		{#if !bundle}
			<p class="py-8 text-center text-xs text-muted-foreground">Sign in required</p>
		{:else if bundle.loading}
			<p class="py-8 text-center text-xs text-muted-foreground">Loading GIFs...</p>
		{:else if bundle.error}
			<p class="py-8 text-center text-xs text-destructive">
				Couldn't reach your syr instance.
			</p>
		{:else if bundle.entries.length === 0}
			<p class="py-8 text-center text-xs text-muted-foreground">
				{debouncedQuery ? 'No GIFs match' : 'No GIFs on your syr instance yet.'}
			</p>
		{:else}
			<div class="grid grid-cols-3 gap-1">
				{#each bundle.entries as gif (gif.local_id ?? gif.url)}
					<button
						type="button"
						onclick={() => pick(gif)}
						class="aspect-video overflow-hidden rounded bg-muted transition-opacity hover:opacity-80"
						title={(gif.tags ?? []).join(', ')}
					>
						<img
							src={proxied(gif.thumbnail_url ?? gif.url)}
							alt=""
							loading="lazy"
							class="h-full w-full object-cover"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
