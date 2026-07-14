/**
 * Client helpers for hosting custom emoji + personal GIFs (P6). Same authed IdP
 * path as the story/post helpers: presign → direct S3 PUT → complete. Only
 * meaningful for local accounts hosted on this syren instance.
 */

import { idpJson } from '../idp-fetch.js';
import type { OwnedEmoji, OwnedGif } from '@syren/types';

interface Envelope<T> {
	status: string;
	data: T;
}

interface Presign {
	signed_url: string;
	final_url: string;
	did: string;
	local_id: string;
}

async function putFile(signedUrl: string, file: File): Promise<void> {
	const res = await fetch(signedUrl, {
		method: 'PUT',
		body: file,
		headers: { 'Content-Type': file.type }
	});
	if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

export type { OwnedEmoji, OwnedGif };

// ── Emoji ───────────────────────────────────────────────────────────────────

/** Presign → PUT → complete a custom emoji under `shortcode`. */
export async function uploadEmoji(
	file: File,
	shortcode: string,
	isSticker = false
): Promise<OwnedEmoji> {
	const { data: presign } = await idpJson<Envelope<Presign>>('/emojis/presign', {
		method: 'POST',
		body: JSON.stringify({
			shortcode,
			filename: file.name,
			mime_type: file.type,
			size: file.size,
			is_sticker: isSticker
		})
	});
	await putFile(presign.signed_url, file);
	const { data } = await idpJson<Envelope<OwnedEmoji>>(
		`/emojis/${encodeURIComponent(presign.local_id)}/complete`,
		{ method: 'POST', body: JSON.stringify({}) }
	);
	return data;
}

export async function listEmojis(): Promise<OwnedEmoji[]> {
	const { data } = await idpJson<Envelope<OwnedEmoji[]>>('/emojis');
	return data;
}

export async function deleteEmoji(did: string, localId: string): Promise<void> {
	await idpJson(`/emojis/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`, {
		method: 'DELETE'
	});
}

// ── GIF ───────────────────────────────────────────────────────────────────

/** Presign → PUT → complete a personal GIF with optional `tags`. */
export async function uploadGif(file: File, tags: string[] = []): Promise<OwnedGif> {
	const { data: presign } = await idpJson<Envelope<Presign>>('/gifs/presign', {
		method: 'POST',
		body: JSON.stringify({
			filename: file.name,
			mime_type: file.type,
			size: file.size,
			...(tags.length ? { tags } : {})
		})
	});
	await putFile(presign.signed_url, file);
	const { data } = await idpJson<Envelope<OwnedGif>>(
		`/gifs/${encodeURIComponent(presign.local_id)}/complete`,
		{ method: 'POST', body: JSON.stringify({}) }
	);
	return data;
}

export async function listGifs(): Promise<OwnedGif[]> {
	const { data } = await idpJson<Envelope<OwnedGif[]>>('/gifs');
	return data;
}

export async function deleteGif(did: string, localId: string): Promise<void> {
	await idpJson(`/gifs/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`, {
		method: 'DELETE'
	});
}
