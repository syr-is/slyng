/**
 * Client helpers for authoring owned posts (P5). Same raw-fetch IdP path as
 * `idp-upload.ts` (session cookie + Bearer via `idpJson`), except the direct S3
 * PUT which goes straight to the presigned URL. Only meaningful for local
 * accounts hosted on this syren instance. The server signs each post's
 * `post@v1` payload with the account's self-delegation key — the client never
 * touches signing keys.
 */

import { idpJson } from '../idp-fetch.js';
import type {
	OwnedPost,
	PostCreate,
	PostUpdate,
	PostType,
	PostVisibility,
	MediaDisplayMode,
	PostContentType
} from '@syren/types';

interface Envelope<T> {
	status: string;
	data: T;
}

export type { OwnedPost, PostType, PostVisibility, MediaDisplayMode, PostContentType };

/** Create a post (draft by default). Returns the owner-facing row with its id. */
export async function createPost(body: PostCreate): Promise<OwnedPost> {
	const { data } = await idpJson<Envelope<OwnedPost>>('/posts', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	return data;
}

/** Patch a post. Server unsets type-mismatched columns + re-signs. */
export async function updatePost(
	did: string,
	localId: string,
	patch: PostUpdate
): Promise<OwnedPost> {
	const { data } = await idpJson<Envelope<OwnedPost>>(
		`/posts/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
		{ method: 'PATCH', body: JSON.stringify(patch) }
	);
	return data;
}

/** One of the caller's own posts (any status). */
export async function getOwnPost(did: string, localId: string): Promise<OwnedPost> {
	const { data } = await idpJson<Envelope<OwnedPost>>(
		`/posts/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`
	);
	return data;
}

/** All of the caller's own posts, newest first. */
export async function listOwnPosts(opts: { limit?: number; offset?: number; search?: string } = {}): Promise<{
	posts: OwnedPost[];
	total: number;
}> {
	const qs = new URLSearchParams();
	if (opts.limit != null) qs.set('limit', String(opts.limit));
	if (opts.offset != null) qs.set('offset', String(opts.offset));
	if (opts.search) qs.set('search', opts.search);
	const suffix = qs.toString() ? `?${qs}` : '';
	const res = await idpJson<Envelope<OwnedPost[]> & { pagination?: { total: number } }>(
		`/posts${suffix}`
	);
	return { posts: res.data, total: res.pagination?.total ?? res.data.length };
}

export async function deletePost(did: string, localId: string): Promise<void> {
	await idpJson(`/posts/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`, {
		method: 'DELETE'
	});
}

/**
 * Presign → PUT a post media asset. Returns the stable public URL to embed in
 * the post's `content` (blog) or `media_urls` (media). `postId` is the post's
 * local id (or `did/localId`); the server derives the S3 key from it.
 */
export async function uploadPostAsset(postId: string, file: File): Promise<string> {
	const { data } = await idpJson<Envelope<{ signed_url: string; final_url: string }>>(
		'/uploads/post-assets',
		{
			method: 'POST',
			body: JSON.stringify({
				post_id: postId,
				filename: file.name,
				mime_type: file.type,
				size: file.size
			})
		}
	);
	const res = await fetch(data.signed_url, {
		method: 'PUT',
		body: file,
		headers: { 'Content-Type': file.type }
	});
	if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
	return data.final_url;
}
