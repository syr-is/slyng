// A TipTap inline atom node for a custom emoji / sticker. Ported from pendi's
// chat editor. Renders an <img> inside the editor (so the composer shows the art
// live) and serializes back to `:shortcode:` / `::shortcode::` in the post
// Markdown (via @tiptap/markdown's `renderMarkdown` hook), so the stored text
// agrees with what the read-side renderer (`@syren/app-core/utils/emoji-render`)
// resolves. `sticker` drives both the render size and `:` vs `::` serialization.
//
// The `url` handed to `insertEmoji` is already `proxied()` by the editor before
// insertion, so no viewer IP leaks when the art loads.
import { Node, mergeAttributes } from '@tiptap/core';

export interface EmojiInsert {
	shortcode: string;
	url: string;
	isSticker: boolean;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		emoji: {
			/** Insert a custom emoji/sticker node at the selection. */
			insertEmoji: (entry: EmojiInsert) => ReturnType;
		};
	}
}

// @tiptap/markdown reads these via getExtensionField; they aren't in the base
// NodeConfig types, so attach them through a spread to avoid excess-property errors.
const markdownSpec = {
	markdownName: 'emoji',
	renderMarkdown: (node: { attrs?: { name?: string; sticker?: boolean } }): string => {
		const name = node.attrs?.name ?? '';
		return node.attrs?.sticker ? `::${name}::` : `:${name}:`;
	}
} as Record<string, unknown>;

export const EmojiNode = Node.create({
	name: 'emoji',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			name: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-emoji') ?? '',
				renderHTML: (attrs) => ({ 'data-emoji': attrs.name })
			},
			url: {
				default: '',
				parseHTML: (el) => el.getAttribute('src') ?? '',
				renderHTML: (attrs) => (attrs.url ? { src: attrs.url } : {})
			},
			sticker: {
				default: false,
				parseHTML: (el) => el.getAttribute('data-sticker') === 'true',
				renderHTML: (attrs) => ({ 'data-sticker': attrs.sticker ? 'true' : 'false' })
			}
		};
	},

	parseHTML() {
		return [{ tag: 'img[data-emoji]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const sticker = !!node.attrs.sticker;
		const code = node.attrs.name as string;
		return [
			'img',
			mergeAttributes(HTMLAttributes, {
				class: sticker ? 'custom-sticker' : 'custom-emoji',
				alt: sticker ? `::${code}::` : `:${code}:`,
				title: `:${code}:`,
				loading: 'lazy',
				draggable: 'false'
			})
		];
	},

	/** Plain-text copy / getText() produces the shortcode. */
	renderText({ node }) {
		const code = node.attrs.name as string;
		return node.attrs.sticker ? `::${code}::` : `:${code}:`;
	},

	addCommands() {
		return {
			insertEmoji:
				(entry: EmojiInsert) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { name: entry.shortcode, url: entry.url, sticker: entry.isSticker }
					})
		};
	},

	...markdownSpec
});
