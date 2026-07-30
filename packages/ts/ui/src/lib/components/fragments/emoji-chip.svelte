<script lang="ts">
	// A rendered custom emoji/sticker in a message. When the viewer is a local
	// account, doesn't already own the shortcode, and it isn't their own message,
	// the emoji becomes a click target that offers to add it to their library —
	// as an emoji or a sticker (same art, their choice). Mirrors pendi's
	// emoji-chip. Non-addable → a plain <img>.
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Popover from '@slyng/ui/popover';
	import { Loader2 } from '@lucide/svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { resolveEmojis, invalidateEmojis } from '@slyng/app-core/stores/emojis.svelte';
	import { addEmojiToLibrary, isLocalIdentity } from '@slyng/app-core/upload/idp-upload';

	let {
		shortcode,
		url,
		size = 'inline',
		allowAdd = false
	}: {
		shortcode: string;
		url: string;
		/** inline emoji, jumbo emoji-only, or block sticker. */
		size?: 'inline' | 'big' | 'sticker';
		/** Gate from the parent (e.g. false for the viewer's own messages). */
		allowAdd?: boolean;
	} = $props();

	const auth = getAuth();
	let isLocal = $state(false);
	let saving = $state(false);
	let saved = $state(false);
	let open = $state(false);

	onMount(async () => {
		if (allowAdd) isLocal = await isLocalIdentity(auth.identity?.syr_instance_url);
	});

	const owned = $derived(
		auth.identity?.did
			? resolveEmojis(auth.identity.did, auth.identity.syr_instance_url).map
			: new Map()
	);
	const canAdd = $derived(allowAdd && isLocal && !saved && !owned.has(shortcode));

	const imgClass = $derived(
		size === 'sticker'
			? 'max-h-32 w-auto object-contain'
			: size === 'big'
				? 'inline-block h-8 w-8 align-[-0.4em] object-contain'
				: 'inline-block h-[1.3em] w-[1.3em] align-[-0.2em] object-contain'
	);

	async function add(asSticker: boolean) {
		if (saving) return;
		saving = true;
		try {
			await addEmojiToLibrary(shortcode, url, asSticker);
			if (auth.identity?.did) invalidateEmojis(auth.identity.did);
			saved = true;
			open = false;
			toast.success(`Added :${shortcode}: to your ${asSticker ? 'stickers' : 'emoji'}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not add emoji');
		} finally {
			saving = false;
		}
	}
</script>

{#if canAdd}
	<Popover.Root bind:open>
		<Popover.Trigger title={`Add :${shortcode}: to your emoji`}>
			<img src={proxied(url)} alt={`:${shortcode}:`} class="{imgClass} cursor-pointer" loading="lazy" />
		</Popover.Trigger>
		<Popover.Content class="w-auto p-2" align="start">
			<p class="px-1 pb-1.5 text-xs text-muted-foreground">
				Add <span class="font-mono text-foreground">:{shortcode}:</span>
			</p>
			<div class="flex gap-1">
				<button
					type="button"
					onclick={() => add(false)}
					disabled={saving}
					class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
				>
					{#if saving}<Loader2 class="size-3 animate-spin" />{/if} Emoji
				</button>
				<button
					type="button"
					onclick={() => add(true)}
					disabled={saving}
					class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
				>
					{#if saving}<Loader2 class="size-3 animate-spin" />{/if} Sticker
				</button>
			</div>
		</Popover.Content>
	</Popover.Root>
{:else}
	<img src={proxied(url)} alt={`:${shortcode}:`} title={`:${shortcode}:`} class={imgClass} loading="lazy" />
{/if}
