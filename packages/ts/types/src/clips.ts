/**
 * Clip picker (GIFs / stickers / clips / memes via Klipy) — ported from pendi's
 * `@pendi/types`. A server-proxied, key-gated media picker for the post editor.
 * The Klipy key is server-only (it's a path segment in Klipy's URL), so the
 * browser only ever talks to slyng's `/api/clips` proxy. Availability is
 * reported IN the response (`available` / `aliveKinds`) so the UI shows a
 * precise "needs a key" state without a separate capability call.
 */

import { z } from 'zod';

/** What the picker browses. Maps to Klipy resource prefixes server-side
 *  (gif→gifs, sticker→stickers, clip→clips, meme→static-memes). */
export const ClipKind = z.enum(['gif', 'sticker', 'clip', 'meme']);
export type ClipKind = z.infer<typeof ClipKind>;

export const ClipFeedMode = z.enum(['trending', 'search', 'recent']);
export type ClipFeedMode = z.infer<typeof ClipFeedMode>;

/** One browsable item, normalized across Klipy's tiered (gif/sticker/meme) and
 *  single-file (clip) shapes. `url` is the best display rendition, `previewUrl`
 *  a lighter grid rendition; `slug` is Klipy's id for view/share/report. */
export const ClipItem = z.object({
	kind: ClipKind,
	slug: z.string(),
	title: z.string().optional(),
	url: z.url(),
	previewUrl: z.url(),
	mp4Url: z.url().optional(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	blurPreview: z.string().optional()
});
export type ClipItem = z.infer<typeof ClipItem>;

/** A sponsored cell Klipy injects inline. `url` is an iframe source — the
 *  creative fires its own impression/click pixels — and it carries no slug, so
 *  it is never selectable or trackable on our side. */
export const ClipAd = z.object({
	url: z.url(),
	width: z.number().int().positive(),
	height: z.number().int().positive()
});
export type ClipAd = z.infer<typeof ClipAd>;

/** Feed entries preserve Klipy's order so ads stay in their injected slots. */
export const ClipFeedEntry = z.discriminatedUnion('type', [
	z.object({ type: z.literal('content'), item: ClipItem }),
	z.object({ type: z.literal('ad'), ad: ClipAd })
]);
export type ClipFeedEntry = z.infer<typeof ClipFeedEntry>;

/** A page of the picker. No total count — page forward while `hasNext`. */
export const ClipFeedResponse = z.object({
	entries: z.array(ClipFeedEntry),
	page: z.number().int().min(1),
	hasNext: z.boolean(),
	/** Masonry hints from Klipy (min content cell width; max ad upscaling %). */
	gridMinWidth: z.number().int().positive().optional(),
	adMaxResizePercent: z.number().int().min(0).optional(),
	/** False when the server has no Klipy key — the UI shows a teach panel. */
	available: z.boolean(),
	/** Which kinds Klipy reports healthy right now (gates the picker tabs). */
	aliveKinds: z.array(ClipKind).optional()
});
export type ClipFeedResponse = z.infer<typeof ClipFeedResponse>;

/** A browse category (Klipy `{category,query,preview_url}`). Tapping it searches `query`. */
export const ClipCategory = z.object({
	label: z.string(),
	query: z.string(),
	previewUrl: z.url().optional()
});
export type ClipCategory = z.infer<typeof ClipCategory>;

export const ClipCategoriesResponse = z.object({
	categories: z.array(ClipCategory),
	available: z.boolean()
});
export type ClipCategoriesResponse = z.infer<typeof ClipCategoriesResponse>;

/** Fire-and-forget engagement signal Klipy expects: `view` on preview, `share`
 *  on pick/send (also populates the user's recents), `report` to flag. */
export const ClipTrackRequest = z.object({
	kind: ClipKind,
	slug: z.string().max(256),
	action: z.enum(['view', 'share', 'report']),
	reason: z.string().max(500).optional()
});
export type ClipTrackRequest = z.infer<typeof ClipTrackRequest>;
