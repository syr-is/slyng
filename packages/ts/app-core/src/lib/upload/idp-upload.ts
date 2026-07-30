/**
 * Client helpers for the local identity-provider authoring surface: profile
 * edits, avatar/banner uploads, and stories. Every call flows through
 * `idpJson` (session cookie + Bearer), except the raw S3 PUT which goes
 * straight to the presigned URL. Only meaningful for local accounts —
 * accounts hosted on this slyng instance (`isLocalIdentity`).
 */

import { idpJson } from '../idp-fetch.js';
import { getHost } from '../host.js';

interface Envelope<T> {
	status: string;
	data: T;
}

/** One story slide as the owner sees it (any status). */
export interface OwnedStory {
	did: string;
	local_id: string;
	filename: string;
	mime_type: string;
	size: number;
	url: string | null;
	status: 'pending' | 'finalizing' | 'completed' | 'failed';
	is_public: boolean;
	is_story: boolean;
	published_at: string | null;
	created_at: string;
	updated_at: string;
	width?: number | null;
	height?: number | null;
	duration_seconds?: number | null;
}

export interface LocalProfile {
	did: string | null;
	username: string;
	display_name?: string;
	bio?: string;
	avatar_url?: string;
	banner_url?: string;
}

async function putToSignedUrl(signedUrl: string, file: File | Blob, mimeType: string): Promise<void> {
	const res = await fetch(signedUrl, {
		method: 'PUT',
		body: file,
		headers: { 'Content-Type': mimeType }
	});
	if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

/**
 * True when `syrInstanceUrl` is served by the instance this app talks to —
 * i.e. the identity is hosted here and can be edited locally. Resolved
 * against the instance manifest's `public_url`; cached for the session.
 */
let _localManifestOrigin: string | null | undefined;
export async function isLocalIdentity(syrInstanceUrl: string | undefined | null): Promise<boolean> {
	if (!syrInstanceUrl) return false;
	if (_localManifestOrigin === undefined) {
		try {
			const res = await fetch(`${getHost()}/.well-known/syr`, { credentials: 'include' });
			const manifest = (await res.json()) as { public_url?: string };
			_localManifestOrigin = manifest.public_url ? new URL(manifest.public_url).origin : null;
		} catch {
			_localManifestOrigin = null;
		}
	}
	if (!_localManifestOrigin) return false;
	try {
		return new URL(syrInstanceUrl).origin === _localManifestOrigin;
	} catch {
		return false;
	}
}

/** Presign → PUT → return the stable public URL for an avatar/banner. */
export async function uploadProfileAsset(kind: 'avatar' | 'banner', file: File): Promise<string> {
	const { data } = await idpJson<Envelope<{ signed_url: string; final_url: string }>>(
		'/user/profile-asset',
		{
			method: 'POST',
			body: JSON.stringify({
				kind,
				filename: file.name,
				mime_type: file.type,
				size: file.size
			})
		}
	);
	await putToSignedUrl(data.signed_url, file, file.type);
	return data.final_url;
}

export async function updateProfile(patch: {
	display_name?: string;
	bio?: string;
	avatar_url?: string | null;
	banner_url?: string | null;
}): Promise<{ display_name?: string; bio?: string; avatar_url?: string; banner_url?: string }> {
	const { data } = await idpJson<
		Envelope<{ display_name?: string; bio?: string; avatar_url?: string; banner_url?: string }>
	>('/user/profile', { method: 'PATCH', body: JSON.stringify(patch) });
	return data;
}

export async function getLocalProfile(did: string): Promise<LocalProfile> {
	const { data } = await idpJson<Envelope<LocalProfile>>(
		`/public/profile/${encodeURIComponent(did)}`
	);
	return data;
}

/**
 * Click-to-add: copy an emoji seen in chat into the caller's own hosted set.
 * The server fetches `sourceUrl` (a resolved public emoji URL), re-uploads it
 * under the caller's DID, and registers it under `shortcode` as emoji or
 * sticker. Only meaningful for local accounts.
 */
export async function addEmojiToLibrary(
	shortcode: string,
	sourceUrl: string,
	isSticker: boolean
): Promise<void> {
	await idpJson('/emojis/copy', {
		method: 'POST',
		body: JSON.stringify({ shortcode, source_url: sourceUrl, is_sticker: isSticker })
	});
}

/** Read intrinsic dimensions of an image/video file (best-effort, browser only). */
async function readDimensions(
	file: File
): Promise<{ width?: number; height?: number; duration_seconds?: number }> {
	if (typeof document === 'undefined') return {};
	const url = URL.createObjectURL(file);
	try {
		if (file.type.startsWith('image/')) {
			return await new Promise((resolve) => {
				const img = new Image();
				img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
				img.onerror = () => resolve({});
				img.src = url;
			});
		}
		if (file.type.startsWith('video/')) {
			return await new Promise((resolve) => {
				const v = document.createElement('video');
				v.preload = 'metadata';
				v.onloadedmetadata = () =>
					resolve({
						width: v.videoWidth,
						height: v.videoHeight,
						duration_seconds: Math.round(v.duration)
					});
				v.onerror = () => resolve({});
				v.src = url;
			});
		}
		return {};
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Presign → PUT → complete. Returns the finalized story. */
export async function uploadStory(file: File): Promise<OwnedStory> {
	const dims = await readDimensions(file);
	const presign = (
		await idpJson<Envelope<{ signed_url: string; final_url: string; did: string; local_id: string }>>(
			'/stories/presign',
			{
				method: 'POST',
				body: JSON.stringify({
					filename: file.name,
					mime_type: file.type,
					size: file.size,
					...(Object.keys(dims).length ? { metadata: dims } : {})
				})
			}
		)
	).data;
	await putToSignedUrl(presign.signed_url, file, file.type);
	const { data } = await idpJson<Envelope<OwnedStory>>(
		`/stories/${encodeURIComponent(presign.local_id)}/complete`,
		{ method: 'POST', body: JSON.stringify(dims) }
	);
	return data;
}

export async function listStories(): Promise<OwnedStory[]> {
	const { data } = await idpJson<Envelope<OwnedStory[]>>('/stories');
	return data;
}

export async function deleteStory(did: string, localId: string): Promise<void> {
	await idpJson(`/stories/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`, {
		method: 'DELETE'
	});
}
