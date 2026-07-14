/**
 * Client helpers for the personal file library (P7): folders, uploads, storage
 * quota, and share links. Same authed IdP path as the story/emoji/GIF helpers —
 * presign → direct S3 PUT → complete. Only meaningful for local accounts hosted
 * on this slyng instance. Owner routes live under `/library/*` (distinct from
 * the chat `uploads` controller).
 */

import { idpJson } from '../idp-fetch.js';
import type {
	FoldersListResponse,
	FolderCreate,
	FolderUpdate,
	OwnedFolder,
	OwnedUpload,
	OwnedUploadsPage,
	ShareLinkResponse,
	StorageUsage
} from '@slyng/types';

interface Envelope<T> {
	status: string;
	data: T;
}

interface Presign {
	signed_url: string;
	final_url: string;
	upload_id: string;
	did: string;
	local_id: string;
	max_bytes: number;
}

async function putFile(signedUrl: string, file: File): Promise<void> {
	const res = await fetch(signedUrl, {
		method: 'PUT',
		body: file,
		headers: { 'Content-Type': file.type }
	});
	if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

const enc = encodeURIComponent;

export type {
	OwnedUpload,
	OwnedFolder,
	OwnedUploadsPage,
	FoldersListResponse,
	ShareLinkResponse,
	StorageUsage
};

// ── Storage usage ─────────────────────────────────────────────────────

export async function getStorageUsage(): Promise<StorageUsage> {
	const { data } = await idpJson<Envelope<StorageUsage>>('/library/storage-usage');
	return data;
}

// ── Folders ───────────────────────────────────────────────────────────

export async function listFolders(parentId?: string | null): Promise<FoldersListResponse> {
	const qs = parentId ? `?parent_id=${enc(parentId)}` : '';
	const { data } = await idpJson<Envelope<FoldersListResponse>>(`/library/folders${qs}`);
	return data;
}

export async function createFolder(body: FolderCreate): Promise<OwnedFolder> {
	const { data } = await idpJson<Envelope<OwnedFolder>>('/library/folders', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	return data;
}

export async function updateFolder(folderId: string, body: FolderUpdate): Promise<OwnedFolder> {
	const { data } = await idpJson<Envelope<OwnedFolder>>(`/library/folders/${enc(folderId)}`, {
		method: 'PATCH',
		body: JSON.stringify(body)
	});
	return data;
}

export async function deleteFolder(folderId: string, deleteContents = false): Promise<void> {
	const qs = deleteContents ? '?delete_contents=true' : '';
	await idpJson(`/library/folders/${enc(folderId)}${qs}`, { method: 'DELETE' });
}

// ── Files ─────────────────────────────────────────────────────────────

export interface ListFilesOptions {
	/** Omit for all folders, '' for root (unfiled), a folder id for that folder. */
	folderId?: string | null;
	search?: string;
	sort?: 'created_at' | 'updated_at' | 'filename' | 'size';
	order?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export async function listFiles(opts: ListFilesOptions = {}): Promise<OwnedUploadsPage> {
	const q = new URLSearchParams();
	if (opts.folderId !== undefined && opts.folderId !== null) q.set('folder_id', opts.folderId);
	else if (opts.folderId === null) q.set('folder_id', '');
	if (opts.search) q.set('search', opts.search);
	if (opts.sort) q.set('sort', opts.sort);
	if (opts.order) q.set('order', opts.order);
	if (opts.limit !== undefined) q.set('limit', String(opts.limit));
	if (opts.offset !== undefined) q.set('offset', String(opts.offset));
	const qs = q.toString();
	// listFiles returns { status, data: OwnedUpload[], breadcrumbs, pagination }.
	return idpJson<OwnedUploadsPage & { status: string }>(`/library/files${qs ? `?${qs}` : ''}`);
}

/** Presign → PUT → complete a library file, optionally filed + public. */
export async function uploadLibraryFile(
	file: File,
	opts: { folderId?: string | null; isPublic?: boolean } = {}
): Promise<OwnedUpload> {
	const { data: presign } = await idpJson<Envelope<Presign>>('/library/files/presign', {
		method: 'POST',
		body: JSON.stringify({
			filename: file.name,
			mime_type: file.type || 'application/octet-stream',
			size: file.size,
			...(opts.folderId ? { folder_id: opts.folderId } : {}),
			...(opts.isPublic !== undefined ? { is_public: opts.isPublic } : {})
		})
	});
	await putFile(presign.signed_url, file);
	const { data } = await idpJson<Envelope<OwnedUpload>>(
		`/library/files/${enc(presign.local_id)}/complete`,
		{ method: 'POST', body: JSON.stringify({}) }
	);
	return data;
}

export async function patchFile(
	did: string,
	localId: string,
	body: { filename?: string; folder_id?: string | null; is_public?: boolean }
): Promise<OwnedUpload> {
	const { data } = await idpJson<Envelope<OwnedUpload>>(
		`/library/files/${enc(did)}/${enc(localId)}`,
		{ method: 'PATCH', body: JSON.stringify(body) }
	);
	return data;
}

export async function deleteFile(did: string, localId: string): Promise<void> {
	await idpJson(`/library/files/${enc(did)}/${enc(localId)}`, { method: 'DELETE' });
}

export async function shareFile(
	did: string,
	localId: string,
	expiresIn = 3600
): Promise<ShareLinkResponse> {
	const { data } = await idpJson<Envelope<ShareLinkResponse>>(
		`/library/files/${enc(did)}/${enc(localId)}/share`,
		{ method: 'POST', body: JSON.stringify({ expiresIn }) }
	);
	return data;
}
