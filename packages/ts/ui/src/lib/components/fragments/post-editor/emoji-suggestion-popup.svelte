<script lang="ts">
	// Renders the `:`-autocomplete dropdown for the post editor, positioned at the
	// caret via floating-ui. Reads the shared reactive suggestion controller
	// (driven by the @tiptap/suggestion render() hooks). Ported from pendi;
	// emoji urls are proxied and the sticker flag is syren's `is_sticker`.
	import { computePosition, flip, shift, offset } from '@floating-ui/dom';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { emojiSuggestion } from './emoji-suggestion.svelte.js';

	let el = $state<HTMLDivElement | null>(null);

	$effect(() => {
		const rect = emojiSuggestion.rect;
		if (!emojiSuggestion.open || !rect || !el) return;
		const virtual = { getBoundingClientRect: () => rect };
		void computePosition(virtual, el, {
			strategy: 'fixed',
			placement: 'top-start',
			middleware: [offset(8), flip(), shift({ padding: 8 })]
		}).then(({ x, y }) => {
			if (el) {
				el.style.left = `${x}px`;
				el.style.top = `${y}px`;
			}
		});
	});
</script>

{#if emojiSuggestion.open && emojiSuggestion.items.length}
	<div
		bind:this={el}
		class="fixed z-50 max-h-60 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		style="left:0;top:0"
		role="listbox"
	>
		{#each emojiSuggestion.items as item, i (item.shortcode + i)}
			<button
				type="button"
				role="option"
				aria-selected={i === emojiSuggestion.index}
				class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm {i ===
				emojiSuggestion.index
					? 'bg-accent text-accent-foreground'
					: 'hover:bg-accent/60'}"
				onmousedown={(e) => {
					e.preventDefault();
					emojiSuggestion.pick(item);
				}}
				onmouseenter={() => (emojiSuggestion.index = i)}
			>
				<img
					src={proxied(item.url)}
					alt={item.shortcode}
					class="h-5 w-5 shrink-0 object-contain"
					loading="lazy"
				/>
				<span class="truncate font-mono text-xs">:{item.shortcode}:</span>
				{#if item.is_sticker}
					<span class="ml-auto shrink-0 text-[10px] text-muted-foreground">sticker</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
