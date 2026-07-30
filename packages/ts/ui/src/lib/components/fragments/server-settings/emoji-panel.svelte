<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { Loader2, Plus, Trash2, Sticker } from '@lucide/svelte';
	import {
		EMOJI_SHORTCODE_RE,
		MAX_EMOJI_BYTES,
		GIF_ALLOWED_MIME,
		MAX_GIF_BYTES
	} from '@slyng/types';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import {
		listServerEmojiItems,
		uploadServerEmoji,
		deleteServerEmoji,
		listServerGifItems,
		uploadServerGif,
		deleteServerGif,
		type ServerEmojiItem,
		type ServerGifItem
	} from '@slyng/app-core/stores/server-media.svelte';

	/**
	 * Server emoji / sticker / GIF manager (MANAGE_EMOJIS). Presign → PUT →
	 * complete, capped per set; every member of the server can then use these
	 * anywhere on the platform. Mirrors the personal emoji manager.
	 */
	const { serverId }: { serverId: string } = $props();

	// ── Emoji ──
	let emojis = $state<ServerEmojiItem[]>([]);
	let emojiLimit = $state(250);
	let emojiLoading = $state(true);
	let emojiUploading = $state(false);
	let emojiRemoving = $state<string | null>(null);
	let shortcode = $state('');
	let isSticker = $state(false);
	let emojiInput = $state<HTMLInputElement | null>(null);

	const shortcodeValid = $derived(EMOJI_SHORTCODE_RE.test(shortcode.trim()));
	const taken = $derived(emojis.some((e) => e.shortcode === shortcode.trim()));
	const emojiFull = $derived(emojis.length >= emojiLimit);
	const canUploadEmoji = $derived(shortcodeValid && !taken && !emojiUploading && !emojiFull);

	async function loadEmojis() {
		emojiLoading = true;
		try {
			const res = await listServerEmojiItems(serverId);
			emojis = res.items;
			emojiLimit = res.limit;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load server emoji');
		} finally {
			emojiLoading = false;
		}
	}

	async function pickEmoji(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!['image/png', 'image/gif', 'image/webp', 'image/jpeg'].includes(file.type)) {
			toast.error('Emoji must be PNG, GIF, WebP, or JPEG');
			return;
		}
		if (file.size > MAX_EMOJI_BYTES) {
			toast.error('Emoji is too large (max 2 MB)');
			return;
		}
		emojiUploading = true;
		try {
			await uploadServerEmoji(serverId, file, shortcode.trim(), isSticker);
			toast.success(`:${shortcode.trim()}: added to this server`);
			shortcode = '';
			isSticker = false;
			await loadEmojis();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Emoji upload failed');
		} finally {
			emojiUploading = false;
		}
	}

	async function removeEmoji(em: ServerEmojiItem) {
		emojiRemoving = em.id;
		try {
			await deleteServerEmoji(serverId, em.id);
			await loadEmojis();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete emoji');
		} finally {
			emojiRemoving = null;
		}
	}

	// ── GIF ──
	let gifs = $state<ServerGifItem[]>([]);
	let gifLimit = $state(250);
	let gifLoading = $state(true);
	let gifUploading = $state(false);
	let gifRemoving = $state<string | null>(null);
	let gifTags = $state('');
	let gifInput = $state<HTMLInputElement | null>(null);

	const gifFull = $derived(gifs.length >= gifLimit);

	async function loadGifs() {
		gifLoading = true;
		try {
			const res = await listServerGifItems(serverId);
			gifs = res.items;
			gifLimit = res.limit;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load server GIFs');
		} finally {
			gifLoading = false;
		}
	}

	async function pickGif(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!(GIF_ALLOWED_MIME as readonly string[]).includes(file.type)) {
			toast.error('GIF must be GIF, WebP, or MP4');
			return;
		}
		if (file.size > MAX_GIF_BYTES) {
			toast.error('GIF is too large (max 8 MB)');
			return;
		}
		gifUploading = true;
		try {
			const tags = gifTags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			await uploadServerGif(serverId, file, tags);
			toast.success('GIF added to this server');
			gifTags = '';
			await loadGifs();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'GIF upload failed');
		} finally {
			gifUploading = false;
		}
	}

	async function removeGif(g: ServerGifItem) {
		gifRemoving = g.id;
		try {
			await deleteServerGif(serverId, g.id);
			await loadGifs();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete GIF');
		} finally {
			gifRemoving = null;
		}
	}

	onMount(() => {
		loadEmojis();
		loadGifs();
	});
</script>

<div class="space-y-8">
	<!-- Emoji / stickers -->
	<section class="space-y-4">
		<div>
			<p class="text-sm font-medium">Emoji &amp; stickers <span class="text-muted-foreground">({emojis.length}/{emojiLimit})</span></p>
			<p class="text-xs text-muted-foreground">
				Every member can use these with <code>:shortcode:</code> (or <code>::code::</code> for stickers)
				in any channel or DM.
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
			<div class="min-w-[10rem] flex-1 space-y-1">
				<label for="server-emoji-shortcode" class="text-xs text-muted-foreground">Shortcode</label>
				<Input
					id="server-emoji-shortcode"
					bind:value={shortcode}
					placeholder="party_parrot"
					class="h-9"
					aria-invalid={shortcode.length > 0 && !shortcodeValid}
				/>
			</div>
			<label class="flex h-9 items-center gap-1.5 text-xs text-muted-foreground">
				<input type="checkbox" bind:checked={isSticker} class="size-3.5 accent-primary" />
				<Sticker class="size-3.5" /> Sticker
			</label>
			<input
				bind:this={emojiInput}
				type="file"
				accept="image/png,image/gif,image/webp,image/jpeg"
				class="hidden"
				onchange={pickEmoji}
			/>
			<Button size="sm" disabled={!canUploadEmoji} onclick={() => emojiInput?.click()}>
				{#if emojiUploading}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<Plus class="mr-1.5 size-3.5" />{/if}
				Add
			</Button>
		</div>
		{#if shortcode.length > 0 && !shortcodeValid}
			<p class="text-xs text-destructive">2–32 letters, digits, or underscores.</p>
		{:else if taken}
			<p class="text-xs text-destructive">This server already has <code>:{shortcode.trim()}:</code></p>
		{:else if emojiFull}
			<p class="text-xs text-destructive">This server has reached its {emojiLimit}-emoji limit.</p>
		{/if}

		{#if emojiLoading}
			<div class="flex justify-center py-6"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
		{:else if emojis.length === 0}
			<p class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
				No server emoji yet.
			</p>
		{:else}
			<div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
				{#each emojis as em (em.id)}
					<div class="group relative flex flex-col items-center gap-1 rounded-md border border-border p-2" title=":{em.shortcode}:">
						{#if em.url}
							<img src={proxied(em.url)} alt={em.shortcode} class="size-9 object-contain" />
						{/if}
						<span class="w-full truncate text-center font-mono text-[10px] text-muted-foreground">
							{em.is_sticker ? `::${em.shortcode}::` : `:${em.shortcode}:`}
						</span>
						<button
							type="button"
							class="absolute right-0.5 top-0.5 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
							onclick={() => removeEmoji(em)}
							disabled={emojiRemoving === em.id}
							aria-label="Delete emoji"
						>
							{#if emojiRemoving === em.id}<Loader2 class="size-3 animate-spin" />{:else}<Trash2 class="size-3" />{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- GIFs / media -->
	<section class="space-y-4">
		<div>
			<p class="text-sm font-medium">GIFs &amp; media <span class="text-muted-foreground">({gifs.length}/{gifLimit})</span></p>
			<p class="text-xs text-muted-foreground">
				Shared GIFs/clips members can send from the picker. GIF, WebP, or MP4, up to 8&nbsp;MB.
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
			<div class="min-w-[12rem] flex-1 space-y-1">
				<label for="server-gif-tags" class="text-xs text-muted-foreground">Tags (comma-separated, optional)</label>
				<Input id="server-gif-tags" bind:value={gifTags} placeholder="happy, celebrate" class="h-9" />
			</div>
			<input
				bind:this={gifInput}
				type="file"
				accept="image/gif,image/webp,video/mp4"
				class="hidden"
				onchange={pickGif}
			/>
			<Button size="sm" disabled={gifUploading || gifFull} onclick={() => gifInput?.click()}>
				{#if gifUploading}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<Plus class="mr-1.5 size-3.5" />{/if}
				Add
			</Button>
		</div>
		{#if gifFull}
			<p class="text-xs text-destructive">This server has reached its {gifLimit}-GIF limit.</p>
		{/if}

		{#if gifLoading}
			<div class="flex justify-center py-6"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
		{:else if gifs.length === 0}
			<p class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
				No server GIFs yet.
			</p>
		{:else}
			<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
				{#each gifs as g (g.id)}
					<div class="group relative overflow-hidden rounded-md border border-border">
						{#if g.url && g.url.endsWith('.mp4')}
							<video src={proxied(g.url)} class="h-24 w-full object-cover" muted loop playsinline></video>
						{:else if g.url}
							<img src={proxied(g.url)} alt={g.tags.join(' ')} class="h-24 w-full object-cover" />
						{/if}
						<button
							type="button"
							class="absolute right-0.5 top-0.5 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
							onclick={() => removeGif(g)}
							disabled={gifRemoving === g.id}
							aria-label="Delete GIF"
						>
							{#if gifRemoving === g.id}<Loader2 class="size-3 animate-spin" />{:else}<Trash2 class="size-3" />{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
