// A TipTap block node for an embedded image / video in a post. Ported from
// pendi's journal media-node. Unlike pendi (which stored a durable `library:<id>`
// ref resolved to a fresh presigned url), syren posts embed PLAIN, STABLE public
// S3 urls — so `ref` is just the https url and the hydration pass fills the
// transient `url`/`video` from it (see post-editor.svelte). The node itself is
// ref-format-agnostic, so it needs no change: it stores `ref`, renders once the
// `url` is filled, and serializes to Markdown `![alt](ref)`.
//
// DISPLAY is mode-aware (see `addNodeView`): in EDIT the media collapses to a
// compact, selectable CHIP (so the writing surface stays text, not a wall of
// embeds) — clicking it reveals the media + a Replace ("edit") action, and the ✕
// removes it. In PREVIEW the real image/video renders. The edit↔preview swap is
// driven purely by the `.post-preview` class the editor toggles on its root, so
// it's instant and needs no remount. `renderHTML` stays the source of truth for
// HTML serialization / clipboard; the node view only governs the live display.
import { Node, mergeAttributes } from '@tiptap/core';

export interface MediaInsert {
	/** Durable reference — a plain external/S3 https url in syren. */
	ref: string;
	/** Display url known at insert time (skips the first resolve). */
	url?: string;
	/** Render as `<video>` rather than `<img>`. */
	video?: boolean;
	alt?: string;
}

/** The chosen replacement media handed back to the editor to swap a node in place. */
export interface MediaReplacement {
	ref: string;
	url?: string;
	video?: boolean;
}

export interface MediaNodeOptions {
	/** Open a media chooser and call `apply` with the chosen media so the editor can
	 *  swap THIS node's ref/url/video in place — the "edit" action on an expanded
	 *  chip. Null when no replace handler is wired (e.g. a read-only host). */
	requestReplace: ((apply: (next: MediaReplacement) => void) => void) | null;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		media: {
			/** Insert an embedded image/video at the selection. */
			insertMedia: (entry: MediaInsert) => ReturnType;
		};
	}
}

// @tiptap/markdown reads these via getExtensionField; spread them in so they don't
// trip the base NodeConfig excess-property checks. `markdownName: 'image'` makes
// markdown image tokens (`![alt](ref)`) parse into this node.
const markdownSpec = {
	markdownName: 'image',
	renderMarkdown: (node: { attrs?: { ref?: string; alt?: string } }): string =>
		`![${node.attrs?.alt ?? ''}](${node.attrs?.ref ?? ''})`
} as Record<string, unknown>;

// ── Inline Lucide glyphs (the node view is vanilla DOM, so we can't mount the
//    Svelte icon components used elsewhere). Paths are Lucide's, MIT-licensed. ──
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_IMAGE =
	'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>';
const ICON_VIDEO =
	'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>';
const ICON_X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
const ICON_REPLACE =
	'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>';
const ICON_HIDE = '<path d="m18 15-6-6-6 6"/>';

function icon(paths: string): SVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('class', 'post-media-icon');
	svg.setAttribute('aria-hidden', 'true');
	svg.innerHTML = paths;
	return svg;
}

function actionButton(paths: string, label: string): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.appendChild(icon(paths));
	btn.appendChild(document.createTextNode(label));
	return btn;
}

export const MediaNode = Node.create<MediaNodeOptions>({
	name: 'media',
	group: 'block',
	atom: true,
	draggable: false,
	selectable: true,

	addOptions() {
		return { requestReplace: null };
	},

	addAttributes() {
		return {
			// Durable; survives serialization (markdown src / data-ref on the DOM).
			ref: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-ref') ?? el.getAttribute('src') ?? '',
				renderHTML: (attrs) => ({ 'data-ref': attrs.ref })
			},
			// Transient display url — never serialized; filled by the hydration pass.
			url: { default: '', rendered: false },
			// Transient; whether to render <video>. Resolved from the ref extension.
			video: { default: false, rendered: false },
			alt: {
				default: '',
				parseHTML: (el) => el.getAttribute('alt') ?? '',
				renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {})
			}
		};
	},

	parseHTML() {
		return [{ tag: 'img[src]' }, { tag: 'video[src]' }, { tag: 'img[data-ref]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const url = (node.attrs.url as string) || '';
		// Un-hydrated (just loaded, ref not yet resolved): a calm skeleton, never a
		// broken-image glyph. The hydration pass swaps in the real element.
		if (!url) {
			return [
				'div',
				mergeAttributes(HTMLAttributes, {
					class: 'post-media post-media-loading',
					'aria-label': 'Loading media'
				})
			];
		}
		if (node.attrs.video) {
			return [
				'video',
				mergeAttributes(HTMLAttributes, {
					src: url,
					class: 'post-media',
					controls: 'true',
					preload: 'metadata',
					playsinline: 'true'
				})
			];
		}
		return [
			'img',
			mergeAttributes(HTMLAttributes, {
				src: url,
				class: 'post-media',
				loading: 'lazy',
				draggable: 'false'
			})
		];
	},

	// The interactive display: a chip in edit, the real media in preview. CSS
	// (keyed off the editor root's `.post-preview` class + the per-node
	// `.is-expanded` class) decides which is visible; this builds both.
	addNodeView() {
		const options = this.options;
		return ({ node, editor, getPos }) => {
			let current = node;

			const dom = document.createElement('div');
			dom.className = 'post-media-node';
			dom.setAttribute('contenteditable', 'false');

			// ── Chip (edit, collapsed) ──
			const chip = document.createElement('div');
			chip.className = 'post-media-chip';

			const openBtn = document.createElement('button');
			openBtn.type = 'button';
			openBtn.className = 'post-media-chip-open';
			openBtn.title = 'Show media';
			openBtn.setAttribute('aria-expanded', 'false');
			const chipIcon = document.createElement('span');
			chipIcon.className = 'post-media-chip-icon';
			const chipLabel = document.createElement('span');
			chipLabel.className = 'post-media-chip-label';
			openBtn.append(chipIcon, chipLabel);

			const chipRemove = document.createElement('button');
			chipRemove.type = 'button';
			chipRemove.className = 'post-media-chip-remove';
			chipRemove.title = 'Remove';
			chipRemove.setAttribute('aria-label', 'Remove media');
			chipRemove.appendChild(icon(ICON_X));

			chip.append(openBtn, chipRemove);

			// ── Frame (the real media + edit actions) ──
			const frame = document.createElement('div');
			frame.className = 'post-media-frame';
			const holder = document.createElement('div');
			holder.className = 'post-media-holder';
			const actions = document.createElement('div');
			actions.className = 'post-media-actions';

			const replaceBtn = actionButton(ICON_REPLACE, 'Replace');
			const removeBtn = actionButton(ICON_X, 'Remove');
			const hideBtn = actionButton(ICON_HIDE, 'Hide');
			actions.append(replaceBtn, removeBtn, hideBtn);
			frame.append(holder, actions);

			dom.append(chip, frame);

			function currentPos(): number | undefined {
				const p = typeof getPos === 'function' ? getPos() : undefined;
				return typeof p === 'number' ? p : undefined;
			}

			function setExpanded(v: boolean): void {
				dom.classList.toggle('is-expanded', v);
				openBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
			}

			function removeNode(): void {
				if (editor.isDestroyed) return;
				const pos = currentPos();
				if (pos === undefined) return;
				const n = editor.state.doc.nodeAt(pos);
				editor.commands.deleteRange({ from: pos, to: pos + (n ? n.nodeSize : 1) });
			}

			function applyReplacement(next: MediaReplacement): void {
				// The replace upload is async; the editor may have been torn down before
				// it resolves — don't dispatch then.
				if (editor.isDestroyed) return;
				const pos = currentPos();
				if (pos === undefined) return;
				const n = editor.state.doc.nodeAt(pos);
				if (!n || n.type.name !== 'media') return;
				editor.view.dispatch(
					editor.state.tr.setNodeMarkup(pos, undefined, {
						...n.attrs,
						ref: next.ref,
						url: next.url ?? '',
						video: !!next.video
					})
				);
			}

			function renderChip(): void {
				const isVideo = !!current.attrs.video;
				chipIcon.replaceChildren(icon(isVideo ? ICON_VIDEO : ICON_IMAGE));
				const alt = (current.attrs.alt as string) || '';
				chipLabel.textContent = alt || (isVideo ? 'Video' : 'Image');
			}

			function renderMedia(): void {
				const url = (current.attrs.url as string) || '';
				if (!url) {
					const sk = document.createElement('div');
					sk.className = 'post-media post-media-loading';
					sk.setAttribute('aria-label', 'Loading media');
					holder.replaceChildren(sk);
					return;
				}
				if (current.attrs.video) {
					const v = document.createElement('video');
					v.src = url;
					v.controls = true;
					v.preload = 'metadata';
					v.playsInline = true;
					v.className = 'post-media';
					holder.replaceChildren(v);
				} else {
					const img = document.createElement('img');
					img.src = url;
					img.loading = 'lazy';
					img.draggable = false;
					img.className = 'post-media';
					const alt = (current.attrs.alt as string) || '';
					if (alt) img.alt = alt;
					holder.replaceChildren(img);
				}
			}

			openBtn.addEventListener('click', (e) => {
				e.preventDefault();
				setExpanded(true);
			});
			hideBtn.addEventListener('click', (e) => {
				e.preventDefault();
				setExpanded(false);
			});
			chipRemove.addEventListener('click', (e) => {
				e.preventDefault();
				removeNode();
			});
			removeBtn.addEventListener('click', (e) => {
				e.preventDefault();
				removeNode();
			});
			replaceBtn.addEventListener('click', (e) => {
				e.preventDefault();
				options.requestReplace?.(applyReplacement);
			});

			renderChip();
			renderMedia();

			return {
				dom,
				update: (updated) => {
					if (updated.type.name !== 'media') return false;
					current = updated;
					renderChip();
					renderMedia();
					return true;
				},
				selectNode: () => dom.classList.add('is-selected'),
				deselectNode: () => dom.classList.remove('is-selected'),
				// Widget-like node: let native button clicks / video controls run and
				// keep ProseMirror from re-parsing our imperative DOM updates.
				stopEvent: () => true,
				ignoreMutation: () => true
			};
		};
	},

	addCommands() {
		return {
			insertMedia:
				(entry: MediaInsert) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							ref: entry.ref,
							url: entry.url ?? '',
							video: !!entry.video,
							alt: entry.alt ?? ''
						}
					})
		};
	},

	...markdownSpec
});
