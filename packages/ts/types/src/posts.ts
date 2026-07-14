/**
 * Owned blog/media posts — ported from syr's `posts.ts`.
 *
 * Wire-shape parity with syr so federated consumers parse slyng-hosted posts
 * unchanged. The one deliberate divergence from syr is the signing MODEL, not
 * the payload: syr signs post mutations on the CLIENT (the browser holds the
 * key) and ships a `signed_mutation` envelope. Slyng local accounts are
 * server-custody (slyng holds the Aegis seed), so the server signs the
 * canonical `post@v1` payload with the account's self-delegation key — exactly
 * as `ProfileService` signs `profile@v1`. The signed payload SHAPE still
 * matches syr, so a remote verifier chains signature → delegate key →
 * root-signed delegation → DID identically.
 */

import { z } from 'zod';
import { UploadMetadataSchema } from './idp.js';

export const PostTypeSchema = z.enum(['blog', 'media']);
export type PostType = z.infer<typeof PostTypeSchema>;

export const PostContentTypeSchema = z.enum(['markdown', 'html']);
export type PostContentType = z.infer<typeof PostContentTypeSchema>;

export const PostVisibilitySchema = z.enum(['public', 'unlisted', 'private']);
export type PostVisibility = z.infer<typeof PostVisibilitySchema>;

/** Media layout hint. Matches syr's four modes exactly. */
export const MediaDisplayModeSchema = z.enum(['carousel', 'masonry', 'gallery', 'cards']);
export type MediaDisplayMode = z.infer<typeof MediaDisplayModeSchema>;

export const PostStatusSchema = z.enum(['draft', 'completed']);
export type PostStatus = z.infer<typeof PostStatusSchema>;

/**
 * Create body. The server owns id, timestamps, author, and the signature
 * triple, so those aren't accepted here. `blog` posts require a `content_type`;
 * `media` posts must not carry one (they use `media_urls` + `display_mode`).
 */
export const PostCreateSchema = z
	.object({
		type: PostTypeSchema,
		content_type: PostContentTypeSchema.optional(),
		title: z.string().max(300).optional(),
		description: z.string().max(280).optional(),
		content: z.string().optional(),
		media_urls: z.array(z.string()).optional(),
		display_mode: MediaDisplayModeSchema.optional(),
		visibility: PostVisibilitySchema.default('public'),
		status: PostStatusSchema.default('draft'),
		// Explicit local id — only for identity import (P11), to preserve the
		// source ULID so cross-instance post links survive a migration.
		post_local_id: z.string().min(1).optional()
	})
	.superRefine((val, ctx) => {
		if (val.type === 'media' && val.content_type) {
			ctx.addIssue({
				code: 'custom',
				message: 'media posts must not set content_type',
				path: ['content_type']
			});
		}
		if (val.type === 'blog' && !val.content_type) {
			ctx.addIssue({
				code: 'custom',
				message: 'blog posts require a content_type',
				path: ['content_type']
			});
		}
	});
export type PostCreate = z.infer<typeof PostCreateSchema>;

/**
 * PATCH body — every field optional. When `type` changes, the server unsets
 * the now-irrelevant columns (blog↔media) itself, so the client never sends
 * nulls. Type-consistency is only enforced when `type` is present.
 */
export const PostUpdateSchema = z
	.object({
		type: PostTypeSchema.optional(),
		content_type: PostContentTypeSchema.optional(),
		title: z.string().max(300).optional(),
		description: z.string().max(280).optional(),
		content: z.string().optional(),
		media_urls: z.array(z.string()).optional(),
		display_mode: MediaDisplayModeSchema.optional(),
		visibility: PostVisibilitySchema.optional(),
		status: PostStatusSchema.optional()
	})
	.superRefine((val, ctx) => {
		if (val.type === 'media' && val.content_type) {
			ctx.addIssue({
				code: 'custom',
				message: 'media posts must not set content_type',
				path: ['content_type']
			});
		}
	});
export type PostUpdate = z.infer<typeof PostUpdateSchema>;

/**
 * Owner-facing post row — returned by the authored endpoints (list own,
 * get own, create, update). Composite id is flattened to `did` + `local_id`.
 */
export const OwnedPostSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	type: PostTypeSchema,
	content_type: PostContentTypeSchema.optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	content: z.string().optional(),
	media_urls: z.array(z.string()).optional(),
	display_mode: MediaDisplayModeSchema.optional(),
	visibility: PostVisibilitySchema,
	status: PostStatusSchema,
	created_at: z.string(),
	updated_at: z.string(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});
export type OwnedPost = z.infer<typeof OwnedPostSchema>;

/**
 * Full public post — single public read + `?full=1` list entries. Same public
 * fields a reader is allowed to see (only public + completed posts ever reach
 * this shape; drafts / unlisted / private are filtered server-side).
 */
export const PublicPostSchema = OwnedPostSchema;
export type PublicPost = z.infer<typeof PublicPostSchema>;

/** Lightweight list entry (default public list) — omits the heavy `content`. */
export const PublicPostSummarySchema = OwnedPostSchema.omit({ content: true });
export type PublicPostSummary = z.infer<typeof PublicPostSummarySchema>;

export const PostPaginationSchema = z.object({
	limit: z.number(),
	offset: z.number(),
	total: z.number(),
	has_more: z.boolean()
});
export type PostPagination = z.infer<typeof PostPaginationSchema>;

export const PublicPostsResponseSchema = z.object({
	did: z.string(),
	posts: z.array(z.union([PublicPostSchema, PublicPostSummarySchema])),
	pagination: PostPaginationSchema
});
export type PublicPostsResponse = z.infer<typeof PublicPostsResponseSchema>;

/**
 * Presign request for a post media asset. Mirrors syr's
 * `UploadCreateSchema.extend({ post_id })` — `post_id` is the post's local
 * ULID (or `did/localId`); the server derives the `posts/{ulid}/public/{...}`
 * S3 key from it.
 */
export const PostAssetPresignSchema = z.object({
	post_id: z.string().min(1),
	filename: z.string().min(1),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	metadata: UploadMetadataSchema.optional()
});
export type PostAssetPresign = z.infer<typeof PostAssetPresignSchema>;
