import { z } from 'zod';

/**
 * Custom-emoji / sticker hosting (P6). Owner uploads an image under a
 * shortcode; the public list is the federation surface slyng's `emojis.svelte`
 * store consumes — `{ shortcode, url, is_sticker }` rows + a `has_more` flag.
 * Owned composite-id content: `emoji:{ created_by: <did>, id: <ulid> }`.
 *
 * Wire contract ported from syr (packages/ts/types/src/emojis.ts) and, for the
 * public shape, from what slyng's emoji store already parses.
 */

/** Discord/syr-style shortcode: letters, digits, underscores; 2–32 chars. */
export const EMOJI_SHORTCODE_RE = /^[a-z0-9_]{2,32}$/i;
export const EMOJI_ALLOWED_MIME = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'] as const;
export const MAX_EMOJI_BYTES = 2 * 1024 * 1024; // 2 MB — emoji are small glyphs

export const EmojiStatusSchema = z.enum(['pending', 'completed']);
export type EmojiStatus = z.infer<typeof EmojiStatusSchema>;

/** Presign a new emoji upload. Shortcode + sticker flag are captured up front
 *  (like the story flow) so `complete` only has to verify the S3 object. */
export const EmojiPresignSchema = z.object({
	shortcode: z
		.string()
		.trim()
		.regex(EMOJI_SHORTCODE_RE, 'Shortcode must be 2–32 letters, digits, or underscores'),
	filename: z.string().min(1),
	mime_type: z.enum(EMOJI_ALLOWED_MIME),
	size: z.number().int().positive().max(MAX_EMOJI_BYTES),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	is_sticker: z.boolean().optional()
});
export type EmojiPresign = z.infer<typeof EmojiPresignSchema>;

export const EmojiCompleteSchema = z.object({
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional()
});
export type EmojiComplete = z.infer<typeof EmojiCompleteSchema>;

/** Owner-facing emoji row (any status). */
export const OwnedEmojiSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	shortcode: z.string(),
	url: z.string().nullable(),
	is_sticker: z.boolean(),
	mime_type: z.string(),
	size: z.number().int().nonnegative(),
	status: EmojiStatusSchema,
	created_at: z.string(),
	updated_at: z.string()
});
export type OwnedEmoji = z.infer<typeof OwnedEmojiSchema>;

/** Public emoji entry — matches syr's public shape (the store reads the first
 *  three; `did`/`local_id` let consumers address the entry). */
export const PublicEmojiSchema = z.object({
	shortcode: z.string(),
	url: z.string(),
	is_sticker: z.boolean(),
	did: z.string(),
	local_id: z.string()
});
export type PublicEmoji = z.infer<typeof PublicEmojiSchema>;

export const PublicEmojisResponseSchema = z.object({
	data: z.array(PublicEmojiSchema),
	pagination: z.object({
		limit: z.number().int(),
		offset: z.number().int(),
		total: z.number().int(),
		has_more: z.boolean()
	})
});
export type PublicEmojisResponse = z.infer<typeof PublicEmojisResponseSchema>;
