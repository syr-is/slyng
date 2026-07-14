<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Loader2, Plus, Trash2, Sticker } from '@lucide/svelte';
	import { EMOJI_SHORTCODE_RE, MAX_EMOJI_BYTES } from '@syren/types';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { invalidateEmojis } from '@syren/app-core/stores/emojis.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { listEmojis, uploadEmoji, deleteEmoji, type OwnedEmoji } from '@syren/app-core/upload/idp-media';

	/**
	 * Custom-emoji manager (P6). Upload an image under a `:shortcode:` (optionally
	 * as a larger sticker), list existing ones, delete. Uploads go through the IdP
	 * presign→PUT→complete flow; on any change the emoji cache is invalidated so
	 * the chat `:`-autocomplete + picker pick up the new set immediately.
	 */
	const auth = getAuth();

	let emojis = $state<OwnedEmoji[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let removing = $state<string | null>(null);
	let shortcode = $state('');
	let isSticker = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	const shortcodeValid = $derived(EMOJI_SHORTCODE_RE.test(shortcode.trim()));
	const taken = $derived(
		emojis.some((e) => e.status === 'completed' && e.shortcode === shortcode.trim())
	);
	const canUpload = $derived(shortcodeValid && !taken && !uploading);

	async function load() {
		loading = true;
		try {
			emojis = await listEmojis();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load emoji');
		} finally {
			loading = false;
		}
	}

	async function handlePick(e: Event) {
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
		uploading = true;
		try {
			await uploadEmoji(file, shortcode.trim(), isSticker);
			toast.success(`:${shortcode.trim()}: added`);
			shortcode = '';
			isSticker = false;
			if (auth.identity?.did) invalidateEmojis(auth.identity.did);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Emoji upload failed');
		} finally {
			uploading = false;
		}
	}

	async function remove(em: OwnedEmoji) {
		removing = em.local_id;
		try {
			await deleteEmoji(em.did, em.local_id);
			if (auth.identity?.did) invalidateEmojis(auth.identity.did);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete emoji');
		} finally {
			removing = null;
		}
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div>
		<p class="text-sm font-medium">Custom emoji</p>
		<p class="text-xs text-muted-foreground">
			Use them anywhere with <code>:shortcode:</code> (or <code>::code::</code> for stickers). They
			resolve for anyone who can see your messages.
		</p>
	</div>

	<!-- Add row -->
	<div class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
		<div class="flex-1 min-w-[10rem] space-y-1">
			<label for="emoji-shortcode" class="text-xs text-muted-foreground">Shortcode</label>
			<Input
				id="emoji-shortcode"
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
			bind:this={fileInput}
			type="file"
			accept="image/png,image/gif,image/webp,image/jpeg"
			class="hidden"
			onchange={handlePick}
		/>
		<Button size="sm" disabled={!canUpload} onclick={() => fileInput?.click()}>
			{#if uploading}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<Plus class="mr-1.5 size-3.5" />{/if}
			Add
		</Button>
	</div>
	{#if shortcode.length > 0 && !shortcodeValid}
		<p class="text-xs text-destructive">2–32 letters, digits, or underscores.</p>
	{:else if taken}
		<p class="text-xs text-destructive">You already have <code>:{shortcode.trim()}:</code></p>
	{/if}

	<!-- Grid -->
	{#if loading}
		<div class="flex justify-center py-6"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
	{:else if emojis.length === 0}
		<p class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
			No custom emoji yet.
		</p>
	{:else}
		<div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
			{#each emojis as em (em.local_id)}
				<div
					class="group relative flex flex-col items-center gap-1 rounded-md border border-border p-2 {em.status !==
					'completed'
						? 'opacity-50'
						: ''}"
					title=":{em.shortcode}:"
				>
					{#if em.url}
						<img src={proxied(em.url)} alt={em.shortcode} class="size-9 object-contain" />
					{/if}
					<span class="w-full truncate text-center font-mono text-[10px] text-muted-foreground">
						{em.is_sticker ? `::${em.shortcode}::` : `:${em.shortcode}:`}
					</span>
					<button
						type="button"
						class="absolute right-0.5 top-0.5 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
						onclick={() => remove(em)}
						disabled={removing === em.local_id}
						aria-label="Delete emoji"
					>
						{#if removing === em.local_id}<Loader2 class="size-3 animate-spin" />{:else}<Trash2 class="size-3" />{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
