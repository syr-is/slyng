// A TipTap inline atom node for a user / @everyone mention. Mirrors the emoji
// node: renders a `@name` pill inside the editor (so the composer shows the
// resolved name live) and serializes back to `<@did>` / `<@everyone>` in the
// message Markdown (via @tiptap/markdown's `renderMarkdown` hook, whose output
// is written verbatim — not markdown-escaped — so the angle brackets survive).
// The read-side tokenizer (`@slyng/app-core/utils/emoji-render`) extracts that
// token before markdown runs and renders it as a <MentionChip>.
import { Node, mergeAttributes } from '@tiptap/core';

export interface MentionInsert {
	/** `'everyone'` or a `did:syr:…` DID. */
	did: string;
	/** Display name shown in the pill (without the leading `@`). */
	label: string;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		mention: {
			/** Insert a mention node at the selection. */
			insertMention: (entry: MentionInsert) => ReturnType;
		};
	}
}

// @tiptap/markdown reads these via getExtensionField; attach through a spread
// to avoid excess-property errors on the base NodeConfig type.
const markdownSpec = {
	markdownName: 'mention',
	renderMarkdown: (node: { attrs?: { did?: string } }): string => `<@${node.attrs?.did ?? ''}>`
} as Record<string, unknown>;

export const MentionNode = Node.create({
	name: 'mention',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			did: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-did') ?? '',
				renderHTML: (attrs) => ({ 'data-did': attrs.did })
			},
			label: {
				default: '',
				parseHTML: (el) =>
					el.getAttribute('data-label') ?? el.textContent?.replace(/^@/, '') ?? '',
				renderHTML: (attrs) => ({ 'data-label': attrs.label })
			}
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-did]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const label = (node.attrs.label as string) || (node.attrs.did as string);
		return ['span', mergeAttributes(HTMLAttributes, { class: 'mention' }), `@${label}`];
	},

	/** Plain-text copy / getText() produces the wire token. */
	renderText({ node }) {
		return `<@${node.attrs.did}>`;
	},

	addCommands() {
		return {
			insertMention:
				(entry: MentionInsert) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { did: entry.did, label: entry.label }
					})
		};
	},

	...markdownSpec
});
