<script lang="ts">
	// The post WYSIWYG editor — a TipTap surface with a visible formatting toolbar
	// (StarterKit: headings, lists, quote, code, rules, bold/italic/underline/
	// strike), syren's custom emoji/sticker node + `:`-autocomplete, image/video
	// upload, and a custom media node. Ported from pendi's journal-editor, with
	// pendi's `library:<id>` indirection removed — syren posts embed PLAIN, STABLE
	// public S3 urls, so a media `ref` IS its url. Serializes to Markdown; emits
	// `onChange(markdown)` on every edit for the compose surface to autosave.
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import { marked } from 'marked';
	import {
		Bold,
		Italic,
		Underline as UnderlineIcon,
		Strikethrough,
		Heading1,
		Heading2,
		List,
		ListOrdered,
		Quote,
		Code,
		Minus,
		ImagePlus,
		LoaderCircle
	} from '@lucide/svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { resolveEmojis } from '@syren/app-core/stores/emojis.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { uploadPostAsset } from '@syren/app-core/upload/idp-post';
	import { toast } from 'svelte-sonner';
	import { EmojiNode } from './emoji-node.js';
	import { EmojiSuggestion } from './emoji-suggestion.svelte.js';
	import EmojiSuggestionPopup from './emoji-suggestion-popup.svelte';
	import { MediaNode, type MediaReplacement } from './media-node.js';
	import MediaPicker from '../media-picker.svelte';
	import type { ClipItem } from '@syren/types';

	let {
		content = '',
		editable = true,
		postId,
		onChange,
		toolbarEnd
	}: {
		/** Initial Markdown loaded into the editor once on mount. */
		content?: string;
		editable?: boolean;
		/** Post local id (or `did/localId`) — media uploads land under its S3 folder. */
		postId: string;
		onChange?: (markdown: string) => void;
		/** Optional controls pinned to the right of the toolbar (e.g. a Preview/Edit
		 *  switch). When provided, the toolbar renders even in read-only mode. */
		toolbarEnd?: Snippet;
	} = $props();

	const auth = getAuth();

	let host = $state<HTMLDivElement | null>(null);
	// Not $state: Svelte's deep proxy would corrupt TipTap's internals. A separate
	// `ready` flag drives any post-mount UI.
	let editor: Editor | null = null;
	let ready = $state(false);
	let empty = $state(true);
	let uploading = $state(false);
	let marks = $state<Record<string, boolean>>({});

	function getMarkdown(): string {
		if (!editor) return '';
		const md = (editor as Editor & { getMarkdown?: () => string }).getMarkdown?.();
		return (md ?? editor.getText()).trim();
	}

	// Stored content is Markdown. We render it to HTML with `marked` and load THAT as
	// the editor's initial content, so headings/bold/lists/quotes AND media all parse.
	// Media round-trips through HTML: `![alt](ref)` → `<img src="ref">`, which
	// MediaNode's parseHTML matches (ref = data-ref ?? src), then the hydration pass
	// fills the display url. (@tiptap/markdown's own parse drops the image url, so the
	// HTML route is both simpler and lossless.) Standalone images are unwrapped from
	// their `<p>` so the block media node parses cleanly.
	function mdToHtml(md: string): string {
		if (!md.trim()) return '';
		const html = marked.parse(md, { async: false }) as string;
		return html.replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/gi, '$1');
	}

	function refreshMarks(): void {
		if (!editor) return;
		marks = {
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			underline: editor.isActive('underline'),
			strike: editor.isActive('strike'),
			h1: editor.isActive('heading', { level: 1 }),
			h2: editor.isActive('heading', { level: 2 }),
			bullet: editor.isActive('bulletList'),
			ordered: editor.isActive('orderedList'),
			quote: editor.isActive('blockquote'),
			code: editor.isActive('codeBlock')
		};
	}

	// ── Hydration: fill transient url/video on media nodes (from their plain-url
	//    ref) + turn saved `:code:` / `::code::` text back into live emoji nodes.
	//    The emoji block re-runs a few times because the catalog resolves async. ──
	function hydrate(): number {
		if (!editor) return 0;
		let pending = 0;
		const tr = editor.state.tr;
		let changed = false;

		// Media: a syren ref is a plain https url — fill url + re-derive the video
		// flag from the extension (the `![](url)` markdown doesn't carry it).
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name !== 'media' || node.attrs.url) return;
			const ref = node.attrs.ref as string;
			if (!ref || !/^https?:/i.test(ref)) return;
			const video = !!node.attrs.video || /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(ref);
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, url: ref, video });
			changed = true;
		});

		// Emoji/stickers: replace shortcode text with live emoji nodes from the
		// caller's own hosted catalog (empty for local accounts until P6 → no-op).
		const did = auth.identity?.did;
		const bundle = did ? resolveEmojis(did, auth.identity?.syr_instance_url) : null;
		if (bundle?.loading) pending++;
		else if (bundle && bundle.map.size) {
			const re = /(::?)([a-z0-9_+-]+)\1/gi; // :code: or ::code::
			editor.state.doc.descendants((node, pos) => {
				if (!node.isText || !node.text) return;
				const text = node.text;
				let mm: RegExpExecArray | null;
				re.lastIndex = 0;
				while ((mm = re.exec(text))) {
					const sticker = mm[1] === '::';
					const entry = bundle.map.get(mm[2]);
					if (!entry) continue;
					const from = pos + mm.index;
					const to = from + mm[0].length;
					tr.replaceWith(
						tr.mapping.map(from),
						tr.mapping.map(to),
						editor!.schema.nodes.emoji.create({
							name: mm[2],
							url: proxied(entry.url),
							sticker: sticker || entry.is_sticker
						})
					);
					changed = true;
				}
			});
		}

		if (changed) editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('hydration', true));
		return pending;
	}

	function hydrateUntilSettled(tries = 0): void {
		const pending = hydrate();
		if (pending > 0 && tries < 12) setTimeout(() => hydrateUntilSettled(tries + 1), 250);
	}

	// ── Media upload ──────────────────────────────────────────────────────────
	async function uploadAndInsert(file: File): Promise<void> {
		if (!editor || uploading) return;
		if (!postId) {
			toast.error('Save the post first before adding media.');
			return;
		}
		uploading = true;
		try {
			const url = await uploadPostAsset(postId, file);
			editor
				.chain()
				.focus()
				.insertMedia({ ref: url, url, video: file.type.startsWith('video/') })
				.run();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't add that file.");
		} finally {
			uploading = false;
		}
	}

	let fileInput = $state<HTMLInputElement | null>(null);
	function onFilePicked(e: Event): void {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void uploadAndInsert(file);
		input.value = '';
	}

	// ── Klipy pick → insert as a media node. GIFs/stickers/memes embed the full
	//    image url; clips embed the mp4 as video. The url is a Klipy CDN link (a
	//    plain https ref MediaNode handles); public reads proxy it like any remote
	//    asset. No S3 upload — Klipy hosts it. ──
	function insertClip(item: ClipItem): void {
		if (!editor) return;
		const isClip = item.kind === 'clip';
		const url = isClip ? (item.mp4Url ?? item.url) : item.url;
		editor.chain().focus().insertMedia({ ref: url, url, video: isClip }).run();
	}

	// ── "Saved" pick → one of the user's own hosted GIFs (a stable local S3 url).
	//    Same media node as a Klipy pick. ──
	function insertSaved(item: { url: string; video: boolean }): void {
		if (!editor) return;
		editor.chain().focus().insertMedia({ ref: item.url, url: item.url, video: item.video }).run();
	}

	// ── Replace ("edit") an existing media chip in place. ──
	let replaceInput = $state<HTMLInputElement | null>(null);
	let pendingReplace: ((next: MediaReplacement) => void) | null = null;
	function handleReplaceRequest(apply: (next: MediaReplacement) => void): void {
		pendingReplace = apply;
		replaceInput?.click();
	}
	function onReplacePicked(e: Event): void {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		const apply = pendingReplace;
		pendingReplace = null;
		if (file && apply) void uploadAndReplace(file, apply);
	}
	async function uploadAndReplace(
		file: File,
		apply: (next: MediaReplacement) => void
	): Promise<void> {
		if (uploading) {
			toast.error('Still finishing the last upload — try again in a moment.');
			return;
		}
		if (!postId) {
			toast.error('Save the post first before adding media.');
			return;
		}
		uploading = true;
		try {
			const url = await uploadPostAsset(postId, file);
			apply({ ref: url, url, video: file.type.startsWith('video/') });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't add that file.");
		} finally {
			uploading = false;
		}
	}

	onMount(() => {
		const ed = new Editor({
			element: host!,
			extensions: [
				StarterKit,
				Markdown,
				EmojiNode,
				EmojiSuggestion(),
				MediaNode.configure({ requestReplace: handleReplaceRequest })
			],
			content: mdToHtml(content),
			editable,
			editorProps: {
				attributes: { class: 'post-prose', role: 'textbox', 'aria-label': 'Post body' }
			},
			onUpdate: ({ editor, transaction }) => {
				empty = editor.isEmpty;
				refreshMarks();
				// The on-load hydration pass dispatches doc transactions too; skip
				// autosave for those so opening a post doesn't spuriously re-save.
				if (!transaction.getMeta('hydration')) onChange?.(getMarkdown());
			},
			onSelectionUpdate: refreshMarks,
			onTransaction: refreshMarks
		});
		editor = ed;
		// `.post-preview` on the root drives the media node views' chip↔media swap
		// (chip while editing, real media in preview) entirely through CSS.
		ed.view.dom.classList.toggle('post-preview', !editable);
		ready = true;
		empty = ed.isEmpty;
		refreshMarks();
		hydrateUntilSettled();
	});

	onDestroy(() => editor?.destroy());

	$effect(() => {
		if (!editor) return;
		// `emitUpdate = false`: toggling editability must NOT fire onUpdate, or it
		// would trip onChange → autosave → the content prop and loop.
		if (editor.isEditable !== editable) editor.setEditable(editable, false);
		editor.view.dom.classList.toggle('post-preview', !editable);
	});

	const cmd = {
		bold: () => editor?.chain().focus().toggleBold().run(),
		italic: () => editor?.chain().focus().toggleItalic().run(),
		underline: () => editor?.chain().focus().toggleUnderline().run(),
		strike: () => editor?.chain().focus().toggleStrike().run(),
		h1: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
		h2: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
		bullet: () => editor?.chain().focus().toggleBulletList().run(),
		ordered: () => editor?.chain().focus().toggleOrderedList().run(),
		quote: () => editor?.chain().focus().toggleBlockquote().run(),
		code: () => editor?.chain().focus().toggleCodeBlock().run(),
		rule: () => editor?.chain().focus().setHorizontalRule().run()
	};
</script>

{#snippet tbtn(label: string, Icon: typeof Bold, run: () => void, active = false)}
	<button
		type="button"
		title={label}
		aria-label={label}
		aria-pressed={active}
		class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-primary/15 aria-pressed:text-primary"
		onclick={run}
	>
		<Icon class="size-4" />
	</button>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if editable || toolbarEnd}
		<div
			class="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1.5"
			role="toolbar"
			aria-label="Post toolbar"
		>
			{#if editable}
				{@render tbtn('Bold', Bold, cmd.bold, marks.bold)}
				{@render tbtn('Italic', Italic, cmd.italic, marks.italic)}
				{@render tbtn('Underline', UnderlineIcon, cmd.underline, marks.underline)}
				{@render tbtn('Strikethrough', Strikethrough, cmd.strike, marks.strike)}
				<span class="mx-1 h-5 w-px bg-border"></span>
				{@render tbtn('Heading', Heading1, cmd.h1, marks.h1)}
				{@render tbtn('Subheading', Heading2, cmd.h2, marks.h2)}
				{@render tbtn('Bullet list', List, cmd.bullet, marks.bullet)}
				{@render tbtn('Numbered list', ListOrdered, cmd.ordered, marks.ordered)}
				{@render tbtn('Quote', Quote, cmd.quote, marks.quote)}
				{@render tbtn('Code block', Code, cmd.code, marks.code)}
				{@render tbtn('Divider', Minus, cmd.rule)}
				<span class="mx-1 h-5 w-px bg-border"></span>
				<button
					type="button"
					title="Add image or video"
					aria-label="Add image or video"
					class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
					disabled={uploading}
					onclick={() => fileInput?.click()}
				>
					{#if uploading}
						<LoaderCircle class="size-4 animate-spin" />
					{:else}
						<ImagePlus class="size-4" />
					{/if}
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*,video/*"
					class="hidden"
					onchange={onFilePicked}
				/>
				<MediaPicker onpick={insertClip} onpicksaved={insertSaved} disabled={uploading} />
			{/if}
			{#if toolbarEnd}
				<div class="ml-auto flex items-center">{@render toolbarEnd()}</div>
			{/if}
		</div>
	{/if}

	<div class="relative min-h-0 flex-1 overflow-auto">
		<div bind:this={host} class="h-full"></div>
		{#if empty && editable}
			<span
				class="pointer-events-none absolute top-4 left-4 select-none text-sm text-muted-foreground"
				aria-hidden="true"
			>
				Write your post…
			</span>
		{/if}
		{#if ready}
			<EmojiSuggestionPopup />
		{/if}
	</div>

	<input
		bind:this={replaceInput}
		type="file"
		accept="image/*,video/*"
		class="hidden"
		onchange={onReplacePicked}
	/>
</div>

<style>
	:global(.post-prose) {
		min-height: 100%;
		padding: 1rem;
		outline: none;
		font-size: 0.95rem;
		line-height: 1.65;
	}
	:global(.post-prose:focus) {
		outline: none;
	}
	:global(.post-prose h1) {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0.8em 0 0.3em;
		line-height: 1.25;
	}
	:global(.post-prose h2) {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0.7em 0 0.3em;
	}
	:global(.post-prose p) {
		margin: 0.4em 0;
	}
	:global(.post-prose ul),
	:global(.post-prose ol) {
		margin: 0.4em 0;
		padding-left: 1.4em;
	}
	:global(.post-prose ul) {
		list-style: disc;
	}
	:global(.post-prose ol) {
		list-style: decimal;
	}
	:global(.post-prose blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 0.8em;
		color: var(--muted-foreground);
		margin: 0.5em 0;
	}
	:global(.post-prose pre) {
		background: var(--muted);
		border-radius: 0.5rem;
		padding: 0.7em 0.9em;
		overflow-x: auto;
		font-size: 0.85em;
	}
	:global(.post-prose code) {
		font-family: ui-monospace, monospace;
		font-size: 0.88em;
	}
	:global(.post-prose hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1em 0;
	}
	:global(.post-prose a) {
		color: var(--primary);
		text-decoration: underline;
	}
	:global(.post-prose .custom-emoji) {
		display: inline-block;
		height: 1.4em;
		vertical-align: -0.25em;
	}
	:global(.post-prose .custom-sticker) {
		display: block;
		height: 7rem;
		max-width: 8rem;
	}
	:global(.post-prose .post-media) {
		display: block;
		max-width: 100%;
		max-height: 22rem;
		border-radius: 0.6rem;
		margin: 0.6em 0;
	}
	:global(.post-prose .post-media-loading) {
		height: 10rem;
		width: 100%;
		max-width: 18rem;
		border-radius: 0.6rem;
		margin: 0.6em 0;
		background: var(--muted);
		animation: post-pulse 1.4s ease-in-out infinite;
	}

	/* ── Media: a compact chip while editing, the real media in preview. ── */
	:global(.post-media-node) {
		margin: 0.6em 0;
	}
	:global(.post-media-node.is-selected .post-media-chip),
	:global(.post-media-node.is-selected .post-media-frame) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
		border-radius: 0.6rem;
	}
	:global(.post-media-chip) {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		max-width: 100%;
		padding: 0.15rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: var(--muted);
	}
	:global(.post-media-chip-open) {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		max-width: 18rem;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: 0.45rem;
		background: transparent;
		color: var(--foreground);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
	}
	:global(.post-media-chip-open:hover) {
		background: var(--background);
	}
	:global(.post-media-chip-icon) {
		display: inline-flex;
		flex: none;
		color: var(--muted-foreground);
	}
	:global(.post-media-chip-label) {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	:global(.post-media-chip-remove) {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border: none;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	:global(.post-media-chip-remove:hover) {
		background: var(--background);
		color: var(--destructive);
	}
	:global(.post-media-icon) {
		width: 1rem;
		height: 1rem;
	}
	:global(.post-media-frame) {
		display: none;
	}
	:global(.post-media-node.is-expanded .post-media-frame) {
		display: block;
	}
	:global(.post-media-node.is-expanded .post-media-chip) {
		display: none;
	}
	:global(.post-media-actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	:global(.post-media-actions button) {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		background: var(--muted);
		color: var(--foreground);
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
	}
	:global(.post-media-actions button:hover) {
		background: var(--background);
	}
	:global(.post-media-actions .post-media-icon) {
		width: 0.85rem;
		height: 0.85rem;
	}
	:global(.post-prose.post-preview .post-media-chip) {
		display: none;
	}
	:global(.post-prose.post-preview .post-media-frame) {
		display: block;
	}
	:global(.post-prose.post-preview .post-media-actions) {
		display: none;
	}
	@keyframes post-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 0.85;
		}
	}
</style>
