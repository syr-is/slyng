import { z } from 'zod';

/**
 * Personal GIF library hosting (P6). Owner uploads GIFs (optionally tagged);
 * the public list is the federation surface syren's `gifs.svelte` store
 * consumes — `{ did, local_id, url, thumbnail_url?, tags?, size?, mime_type? }`
 * rows, filtered by an optional `search`. Owned composite-id content:
 * `gif:{ created_by: <did>, id: <ulid> }`.
 *
 * Wire contract ported from syr (packages/ts/types/src/gifs.ts) and, for the
 * public shape, from what syren's gif store already parses.
 */

export const GIF_ALLOWED_MIME = ['image/gif', 'image/webp', 'video/mp4'] as const;
export const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_GIF_TAGS = 12;

export const GifStatusSchema = z.enum(['pending', 'completed']);
export type GifStatus = z.infer<typeof GifStatusSchema>;

/** Presign a new GIF upload. Tags are captured up front; `complete` verifies
 *  the S3 object landed and flips the row to completed. */
export const GifPresignSchema = z.object({
	filename: z.string().min(1),
	mime_type: z.enum(GIF_ALLOWED_MIME),
	size: z.number().int().positive().max(MAX_GIF_BYTES),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	tags: z.array(z.string().trim().min(1).max(40)).max(MAX_GIF_TAGS).optional()
});
export type GifPresign = z.infer<typeof GifPresignSchema>;

export const GifCompleteSchema = z.object({
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	thumbnail_url: z.string().url().optional()
});
export type GifComplete = z.infer<typeof GifCompleteSchema>;

/** Owner-facing GIF row (any status). */
export const OwnedGifSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	url: z.string().nullable(),
	thumbnail_url: z.string().nullable(),
	tags: z.array(z.string()),
	mime_type: z.string(),
	size: z.number().int().nonnegative(),
	status: GifStatusSchema,
	created_at: z.string(),
	updated_at: z.string()
});
export type OwnedGif = z.infer<typeof OwnedGifSchema>;

/** Public GIF entry — the exact shape syren's gif store reads. */
export const PublicGifSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	url: z.string(),
	thumbnail_url: z.string().nullable().optional(),
	tags: z.array(z.string()).optional(),
	size: z.number().optional(),
	mime_type: z.string().optional()
});
export type PublicGif = z.infer<typeof PublicGifSchema>;

export const PublicGifsResponseSchema = z.object({
	data: z.array(PublicGifSchema),
	pagination: z.object({
		limit: z.number().int(),
		offset: z.number().int(),
		total: z.number().int(),
		has_more: z.boolean()
	})
});
export type PublicGifsResponse = z.infer<typeof PublicGifsResponseSchema>;
