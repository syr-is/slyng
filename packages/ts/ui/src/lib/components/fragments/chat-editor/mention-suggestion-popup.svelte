<script lang="ts">
	// The `@`-mention autocomplete dropdown, positioned at the caret via
	// floating-ui. Reads the shared reactive controller driven by the
	// @tiptap/suggestion render() hooks. Mirrors the emoji suggestion popup.
	import { computePosition, flip, shift, offset } from '@floating-ui/dom';
	import { AtSign } from '@lucide/svelte';
	import * as Avatar from '@slyng/ui/avatar';
	import { mentionSuggestion } from './mention-suggestion.svelte.js';

	let el = $state<HTMLDivElement | null>(null);

	$effect(() => {
		const rect = mentionSuggestion.rect;
		if (!mentionSuggestion.open || !rect || !el) return;
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

{#if mentionSuggestion.open && mentionSuggestion.items.length}
	<div
		bind:this={el}
		class="fixed z-50 max-h-60 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		style="left:0;top:0"
		role="listbox"
	>
		{#each mentionSuggestion.items as item, i (item.did + i)}
			<button
				type="button"
				role="option"
				aria-selected={i === mentionSuggestion.index}
				class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm {i ===
				mentionSuggestion.index
					? 'bg-accent text-accent-foreground'
					: 'hover:bg-accent/60'}"
				onmousedown={(e) => {
					e.preventDefault();
					mentionSuggestion.pick(item);
				}}
				onmouseenter={() => (mentionSuggestion.index = i)}
			>
				{#if item.everyone}
					<span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
						<AtSign class="h-3 w-3" />
					</span>
					<span class="truncate font-medium">everyone</span>
					<span class="ml-auto shrink-0 text-[10px] text-muted-foreground">notifies the channel</span>
				{:else}
					<Avatar.Root class="h-5 w-5 shrink-0">
						{#if item.avatarUrl}<Avatar.Image src={item.avatarUrl} alt="" />{/if}
						<Avatar.Fallback class="text-[9px]">{item.label.slice(0, 2).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
					<span class="truncate">{item.label}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
