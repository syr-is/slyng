// `:`-triggered emoji/sticker autocomplete for the post editor. Ported from
// pendi's chat editor, with the catalog rewired from pendi's `emojiCatalog` to
// slyng's `resolveEmojis(did, instance)` store (the caller's OWN hosted emoji
// set). Local emoji hosting lands in P6 — until then `resolveEmojis` returns an
// empty bundle for a local account and the popup simply never opens, which is a
// graceful no-op, not a break.
//
// The @tiptap/suggestion render() hooks drive a small reactive `$state`
// controller; <EmojiSuggestionPopup> (rendered inside post-editor.svelte) reads it.
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { getAuth } from '@slyng/app-core/stores/auth.svelte';
import { resolveEmojis, type EmojiEntry } from '@slyng/app-core/stores/emojis.svelte';
import { proxied } from '@slyng/app-core/utils/proxy';

const auth = getAuth();

/** Search the caller's own emoji catalog by shortcode (starts-with ranked first). */
function searchEmojis(query: string, limit: number): EmojiEntry[] {
	const did = auth.identity?.did;
	if (!did) return [];
	const bundle = resolveEmojis(did, auth.identity?.syr_instance_url);
	const q = query.toLowerCase();
	if (!q) return bundle.entries.slice(0, limit);
	const starts: EmojiEntry[] = [];
	const contains: EmojiEntry[] = [];
	for (const e of bundle.entries) {
		const sc = e.shortcode.toLowerCase();
		if (sc.startsWith(q)) starts.push(e);
		else if (sc.includes(q)) contains.push(e);
	}
	return [...starts, ...contains].slice(0, limit);
}

class EmojiSuggestionController {
	open = $state(false);
	items = $state<EmojiEntry[]>([]);
	index = $state(0);
	rect = $state<DOMRect | null>(null);
	#command: ((entry: EmojiEntry) => void) | null = null;

	start(items: EmojiEntry[], command: (entry: EmojiEntry) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = 0;
		this.rect = rect;
		this.#command = command;
		this.open = true;
	}

	update(items: EmojiEntry[], command: (entry: EmojiEntry) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = Math.min(this.index, Math.max(0, items.length - 1));
		this.rect = rect;
		// CRITICAL: adopt the fresh closure each keystroke. The one from onStart is
		// bound to the empty-query range (covers only ':'), so reusing it replaces
		// just the colon and leaves the typed query behind.
		this.#command = command;
	}

	close(): void {
		this.open = false;
		this.items = [];
		this.rect = null;
		this.#command = null;
	}

	pick(entry: EmojiEntry): void {
		this.#command?.(entry);
	}

	/** Returns true if the key was consumed (so the editor doesn't also act on it). */
	onKeyDown(event: KeyboardEvent): boolean {
		if (!this.open || this.items.length === 0) return false;
		switch (event.key) {
			case 'ArrowDown':
				this.index = (this.index + 1) % this.items.length;
				return true;
			case 'ArrowUp':
				this.index = (this.index - 1 + this.items.length) % this.items.length;
				return true;
			case 'Enter':
			case 'Tab':
				this.pick(this.items[this.index]);
				return true;
			case 'Escape':
				this.close();
				return true;
			default:
				return false;
		}
	}
}

export const emojiSuggestion = new EmojiSuggestionController();

/**
 * Every @tiptap/suggestion plugin defaults to the same `suggestion$` key, so
 * two of them on one editor (the chat composer runs `:` emoji + `@` mention)
 * make ProseMirror throw "Adding different instances of a keyed plugin".
 * Each suggestion owns an explicit key instead.
 */
const emojiSuggestionKey = new PluginKey('emojiSuggestion');

/**
 * `search` selects the catalog: the post editor omits it (defaults to the
 * caller's OWN hosted emoji), while the chat composer passes
 * `searchComposerEmojis` (own ∪ their servers'). The controller + popup are
 * shared — only one editor is ever mounted at a time.
 */
export function EmojiSuggestion(
	search: (query: string, limit: number) => EmojiEntry[] = searchEmojis
) {
	return Extension.create({
		name: 'emojiSuggestion',
		addProseMirrorPlugins() {
			return [
				Suggestion<EmojiEntry>({
					editor: this.editor,
					pluginKey: emojiSuggestionKey,
					char: ':',
					allowSpaces: false,
					// Let the trigger ':' appear in the query so typing the SECOND colon
					// (`::` for a sticker) doesn't break the match and close the popup.
					allowToIncludeChar: true,
					startOfLine: false,
					// `:query` → emoji; `::query` → sticker. With a single ':' trigger the
					// second colon lands in `query` as a leading ':', so strip it for
					// searching. Syntax (`:` vs `::`) drives size, mirroring syr/slyng.
					items: ({ query }) => {
						const q = query.startsWith(':') ? query.slice(1) : query;
						return search(q, 10);
					},
					command: ({ editor, props }) => {
						// Recompute the replace span from the LIVE doc rather than trust the
						// passed `range` (which can be a stale closure). Find the trailing
						// `:query` / `::query` ending at the caret and replace exactly that.
						const { selection } = editor.state;
						const to = selection.$from.pos;
						const before = selection.$from.parent.textBetween(
							Math.max(0, selection.$from.parentOffset - 100),
							selection.$from.parentOffset,
							'\n',
							'￼'
						);
						const m = before.match(/:{1,2}[^\s:]*$/);
						const from = m ? to - m[0].length : to;
						const isSticker = !!m && m[0].startsWith('::');
						editor
							.chain()
							.focus()
							.insertContentAt({ from, to }, [
								{
									type: 'emoji',
									attrs: {
										name: props.shortcode,
										url: proxied(props.url),
										sticker: isSticker || props.is_sticker
									}
								},
								{ type: 'text', text: ' ' }
							])
							.run();
					},
					render: () => ({
						onStart: (p) => {
							emojiSuggestion.start(p.items, (e) => p.command(e), p.clientRect?.() ?? null);
						},
						onUpdate: (p) => {
							emojiSuggestion.update(p.items, (e) => p.command(e), p.clientRect?.() ?? null);
						},
						onKeyDown: (p) => emojiSuggestion.onKeyDown(p.event),
						onExit: () => {
							emojiSuggestion.close();
						}
					})
				})
			];
		}
	});
}
