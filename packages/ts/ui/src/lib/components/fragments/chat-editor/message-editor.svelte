<script lang="ts">
	// Chat message composer — a headless @tiptap/core editor giving the chat input
	// live Markdown (bold/italic/code/strike via StarterKit input rules) plus the
	// `:` emoji / `::` sticker autocomplete. Serializes to Markdown-with-shortcodes
	// on send (`getMarkdown()`), which the read-side renderer (message-item +
	// `renderInlineMarkdown` + emoji tokenizer) resolves back.
	//
	// Block nodes (headings/lists/quote/code-fence/hr) are disabled so the composer
	// and the INLINE-only read renderer stay in agreement — what you type is what
	// posts. Reuses the post editor's EmojiNode + `:`/`::` suggestion (shared
	// controller + popup; only one editor is mounted at a time), with the catalog
	// swapped to `searchComposerEmojis` (own emoji ∪ their servers').
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import { searchComposerEmojis } from '@slyng/app-core/stores/usable-emojis.svelte';
	import { EmojiNode, type EmojiInsert } from '../post-editor/emoji-node.js';
	import { EmojiSuggestion, emojiSuggestion } from '../post-editor/emoji-suggestion.svelte.js';
	import EmojiSuggestionPopup from '../post-editor/emoji-suggestion-popup.svelte';
	import { MentionNode } from './mention-node.js';
	import { MentionSuggestion, mentionSuggestion } from './mention-suggestion.svelte.js';
	import MentionSuggestionPopup from './mention-suggestion-popup.svelte';

	let {
		placeholder = 'Message',
		disabled = false,
		empty = $bindable(true),
		onEnter,
		oninput
	}: {
		placeholder?: string;
		disabled?: boolean;
		empty?: boolean;
		onEnter?: () => void;
		oninput?: () => void;
	} = $props();

	let element = $state<HTMLDivElement>();
	let editor: Editor | undefined;

	/** Markdown-with-shortcodes for sending. */
	export function getMarkdown(): string {
		if (!editor) return '';
		const md = (editor as Editor & { getMarkdown?: () => string }).getMarkdown?.();
		return (md ?? editor.getText()).trim();
	}
	export function clear(): void {
		editor?.commands.clearContent(true);
		empty = true;
	}
	export function focus(): void {
		editor?.commands.focus();
	}
	export function isEmpty(): boolean {
		return editor?.isEmpty ?? true;
	}
	/** Insert a custom emoji/sticker node (from the picker). */
	export function insertEmoji(entry: EmojiInsert): void {
		editor
			?.chain()
			.focus()
			.insertEmoji({ ...entry, url: proxied(entry.url) })
			.run();
	}
	/** Insert plain text (unicode glyph from the picker, pasted text, …). */
	export function insertText(text: string): void {
		editor?.chain().focus().insertContent(text).run();
	}

	onMount(() => {
		editor = new Editor({
			element: element!,
			extensions: [
				StarterKit.configure({
					heading: false,
					codeBlock: false,
					blockquote: false,
					horizontalRule: false,
					bulletList: false,
					orderedList: false,
					listItem: false
				}),
				Markdown,
				EmojiNode,
				EmojiSuggestion(searchComposerEmojis),
				MentionNode,
				MentionSuggestion()
			],
			editable: !disabled,
			editorProps: {
				attributes: {
					class: 'chat-editor focus:outline-none',
					role: 'textbox',
					'aria-label': placeholder,
					'aria-multiline': 'true'
				},
				handleKeyDown: (_view, event) => {
					// Enter sends; Shift+Enter is a newline. When the emoji popup is open,
					// Enter belongs to it (pick the highlighted item), so yield.
					if (event.key === 'Enter' && !event.shiftKey) {
						if (emojiSuggestion.open || mentionSuggestion.open) return false;
						event.preventDefault();
						onEnter?.();
						return true;
					}
					return false;
				}
			},
			onUpdate: ({ editor: ed }) => {
				empty = ed.isEmpty;
				oninput?.();
			}
		});
		empty = editor.isEmpty;
	});

	onDestroy(() => editor?.destroy());

	$effect(() => {
		editor?.setEditable(!disabled, false);
	});
</script>

<div class="relative flex-1">
	<div bind:this={element} class="max-h-40 overflow-y-auto"></div>
	{#if empty}
		<div
			class="pointer-events-none absolute inset-0 select-none text-sm text-muted-foreground"
			aria-hidden="true"
		>
			{placeholder}
		</div>
	{/if}
	<EmojiSuggestionPopup />
	<MentionSuggestionPopup />
</div>

<style>
	/* ProseMirror generates the editable element; :global reaches it. */
	:global(.chat-editor) {
		font-size: 0.875rem;
		line-height: 1.4;
		color: var(--foreground, inherit);
		min-height: 1.5rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
	:global(.chat-editor p) {
		margin: 0;
	}
	:global(.chat-editor .mention) {
		display: inline;
		border-radius: 0.25rem;
		padding: 0 0.2em;
		font-weight: 500;
		color: var(--primary, #6366f1);
		background-color: color-mix(in oklab, var(--primary, #6366f1) 15%, transparent);
		white-space: nowrap;
	}
	:global(.chat-editor .custom-emoji) {
		display: inline-block;
		height: 1.4em;
		width: auto;
		vertical-align: -0.25em;
		object-fit: contain;
	}
	:global(.chat-editor .custom-sticker) {
		display: inline-block;
		height: 2rem;
		width: auto;
		vertical-align: -0.5em;
		object-fit: contain;
	}
</style>
