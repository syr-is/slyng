<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Loader2, Plus, Trash2 } from '@lucide/svelte';
	import { MAX_GIF_BYTES } from '@syren/types';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { invalidateGifs } from '@syren/app-core/stores/gifs.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { listGifs, uploadGif, deleteGif, type OwnedGif } from '@syren/app-core/upload/idp-media';

	/**
	 * Personal-GIF manager (P6). Upload GIFs (optionally tagged for search), list,
	 * delete. Uploads go through the IdP presign→PUT→complete flow; on change the
	 * gif cache is invalidated so pickers pick up the new set.
	 */
	const auth = getAuth();

	let gifs = $state<OwnedGif[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let removing = $state<string | null>(null);
	let tagsInput = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	function parseTags(raw: string): string[] {
		return raw
			.split(',')
			.map((t) => t.trim().toLowerCase())
			.filter(Boolean)
			.slice(0, 12);
	}

	async function load() {
		loading = true;
		try {
			gifs = await listGifs();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load GIFs');
		} finally {
			loading = false;
		}
	}

	async function handlePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/gif', 'image/webp', 'video/mp4'].includes(file.type)) {
			toast.error('GIFs must be GIF, WebP, or MP4');
			return;
		}
		if (file.size > MAX_GIF_BYTES) {
			toast.error('GIF is too large (max 8 MB)');
			return;
		}
		uploading = true;
		try {
			await uploadGif(file, parseTags(tagsInput));
			toast.success('GIF added');
			tagsInput = '';
			if (auth.identity?.did) invalidateGifs(auth.identity.did);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'GIF upload failed');
		} finally {
			uploading = false;
		}
	}

	async function remove(g: OwnedGif) {
		removing = g.local_id;
		try {
			await deleteGif(g.did, g.local_id);
			if (auth.identity?.did) invalidateGifs(auth.identity.did);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete GIF');
		} finally {
			removing = null;
		}
	}

	function isVideo(mime: string): boolean {
		return mime.startsWith('video/');
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div>
		<p class="text-sm font-medium">Your GIFs</p>
		<p class="text-xs text-muted-foreground">
			Personal GIF library hosted on your instance. Tags make them searchable.
		</p>
	</div>

	<!-- Add row -->
	<div class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
		<div class="flex-1 min-w-[12rem] space-y-1">
			<label for="gif-tags" class="text-xs text-muted-foreground">Tags (comma-separated, optional)</label>
			<Input id="gif-tags" bind:value={tagsInput} placeholder="funny, reaction, cat" class="h-9" />
		</div>
		<input
			bind:this={fileInput}
			type="file"
			accept="image/gif,image/webp,video/mp4"
			class="hidden"
			onchange={handlePick}
		/>
		<Button size="sm" disabled={uploading} onclick={() => fileInput?.click()}>
			{#if uploading}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<Plus class="mr-1.5 size-3.5" />{/if}
			Add GIF
		</Button>
	</div>

	<!-- Grid -->
	{#if loading}
		<div class="flex justify-center py-6"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
	{:else if gifs.length === 0}
		<p class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
			No GIFs yet.
		</p>
	{:else}
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
			{#each gifs as g (g.local_id)}
				<div
					class="group relative aspect-video overflow-hidden rounded-md border border-border bg-muted {g.status !==
					'completed'
						? 'opacity-50'
						: ''}"
					title={g.tags.join(', ')}
				>
					{#if g.url && isVideo(g.mime_type)}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={proxied(g.url)} class="h-full w-full object-cover" muted loop></video>
					{:else if g.url}
						<img src={proxied(g.thumbnail_url ?? g.url)} alt="" class="h-full w-full object-cover" />
					{/if}
					<button
						type="button"
						class="absolute right-0.5 top-0.5 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
						onclick={() => remove(g)}
						disabled={removing === g.local_id}
						aria-label="Delete GIF"
					>
						{#if removing === g.local_id}<Loader2 class="size-3 animate-spin" />{:else}<Trash2 class="size-3" />{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
