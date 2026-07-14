import { HttpException, Injectable, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import {
	extractDid,
	extractLocalId,
	type FolderCreate,
	type FolderUpdate,
	type FoldersListResponse,
	type LibraryPresign,
	type OwnedFolder,
	type OwnedUpload,
	type OwnedUploadsPage,
	type ShareLinkResponse,
	type StorageUsage,
	type UploadComplete,
	type UploadPatch
} from '@slyng/types';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { InstanceConfigService } from './instance-config.service';
import {
	FolderRepository,
	LibraryUploadRepository,
	type FolderRow,
	type LibraryUploadRow
} from './idp-content.repository';

const FAR_FUTURE_MS = 365 * 24 * 60 * 60 * 1000; // public share "never expires" sentinel

/**
 * Robustly parse a folder id string back into its RecordId. Accepts the full
 * record form (`folder:abcd`), a bare id, and SurrealDB's `⟨…⟩` id delimiters.
 */
function toFolderRecordId(idStr: string): RecordId {
	const s = idStr.trim();
	const colon = s.indexOf(':');
	const idPart = colon >= 0 && s.slice(0, colon) === 'folder' ? s.slice(colon + 1) : s;
	const clean = idPart.replace(/^⟨([\s\S]*)⟩$/, '$1');
	return new RecordId('folder', clean);
}

/**
 * File-library lifecycle for local accounts (P7): folders, uploads, storage
 * quota, and time-boxed share links — built on the same composite-id
 * `library_upload` table that backs stories (library files are `is_story=false`).
 *
 * Adapted from syr's upload/folder/file-store-usage controllers to slyng's
 * conventions:
 *  - Composite ids embed the owner DID, so there's no separate `owner_id` on
 *    upload rows; ownership is the `id.created_by` half of the key.
 *  - slyng proxies every remote asset through its auth-gated media proxy, so
 *    `is_public` is a pure DB flag (federation listing + share behaviour) rather
 *    than an S3-key/`/public/` prefix + anonymous bucket read. Keys are stable
 *    across a visibility toggle: `uploads/{did}/library/{ulid}`.
 *  - Storage usage is summed straight from the table (no KV counter); the quota
 *    limit comes from `SLYNG_STORAGE_LIMIT_GB` (default 5).
 *
 * Library files don't feed `public_hash`, so mutations here neither broadcast
 * PROFILE_UPDATE nor bump the change digest (unlike profile/story/post/emoji/gif).
 */
@Injectable()
export class LibraryService {
	private readonly logger = new Logger(LibraryService.name);

	constructor(
		private readonly storage: IdpStorageService,
		private readonly uploads: LibraryUploadRepository,
		private readonly folders: FolderRepository,
		private readonly audit: IdpAuditService,
		private readonly instanceConfig: InstanceConfigService
	) {}

	// ── Storage usage ───────────────────────────────────────────────────

	async usage(did: string): Promise<StorageUsage> {
		const limit = await this.instanceConfig.getStorageLimitBytes();
		const used = await this.uploads.sumCompletedSizeByDid(did);
		const percentage = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
		return {
			bytes_used: used,
			bytes_limit: limit,
			percentage_used: percentage,
			bytes_remaining: Math.max(0, limit - used)
		};
	}

	// ── Folders ─────────────────────────────────────────────────────────

	async listFolders(did: string, parentIdStr?: string | null): Promise<FoldersListResponse> {
		let parentRid: RecordId | null = null;
		let breadcrumbs: { id: string; name: string }[] = [];
		if (parentIdStr) {
			parentRid = toFolderRecordId(parentIdStr);
			const parent = await this.folders.findById(parentRid);
			if (!parent || parent.owner_id !== did) throw new HttpException('Folder not found', 404);
			breadcrumbs = (await this.folders.getFullPath(parentRid)).crumbs;
		}
		const rows = await this.folders.findByParent(did, parentRid);
		const folders = await Promise.all(rows.map((r) => this.toOwnedFolder(r)));
		return { folders, breadcrumbs };
	}

	async createFolder(did: string, body: FolderCreate): Promise<OwnedFolder> {
		let parentRid: RecordId | null = null;
		if (body.parent_id) {
			parentRid = toFolderRecordId(body.parent_id);
			const parent = await this.folders.findById(parentRid);
			if (!parent || parent.owner_id !== did) {
				throw new HttpException('Parent folder not found', 400);
			}
		}
		if (await this.folders.siblingExists(did, body.name, parentRid)) {
			throw new HttpException(`A folder named "${body.name}" already exists here`, 409);
		}
		const now = new Date();
		const row = await this.folders.create({
			owner_id: did,
			name: body.name,
			parent_id: parentRid,
			is_public: body.is_public ?? false,
			created_at: now,
			updated_at: now
		});
		void this.audit.record({
			actorDid: did,
			action: 'folder_create',
			targetKind: 'folder',
			targetId: String(row.id),
			metadata: { name: body.name }
		});
		return this.toOwnedFolder(row);
	}

	async updateFolder(did: string, folderIdStr: string, body: FolderUpdate): Promise<OwnedFolder> {
		const folderRid = toFolderRecordId(folderIdStr);
		const folder = await this.folders.findById(folderRid);
		if (!folder || folder.owner_id !== did) throw new HttpException('Folder not found', 404);

		const patch: Partial<FolderRow> = { updated_at: new Date() };
		let destParent: RecordId | null = (folder.parent_id as RecordId | null) ?? null;

		if (body.parent_id !== undefined) {
			if (body.parent_id === null) {
				destParent = null;
			} else {
				const target = toFolderRecordId(body.parent_id);
				if (String(target) === String(folderRid)) {
					throw new HttpException('Cannot move a folder into itself', 400);
				}
				const targetRow = await this.folders.findById(target);
				if (!targetRow || targetRow.owner_id !== did) {
					throw new HttpException('Destination folder not found', 400);
				}
				const descendants = await this.folders.getDescendantIds(folderRid);
				if (descendants.some((d) => String(d) === String(target))) {
					throw new HttpException('Cannot move a folder into its own descendant', 400);
				}
				destParent = target;
			}
			patch.parent_id = destParent;
		}

		const destName = body.name ?? folder.name;
		if (body.name !== undefined) patch.name = body.name;
		if (await this.folders.siblingExists(did, destName, destParent, folderRid)) {
			throw new HttpException(`A folder named "${destName}" already exists here`, 409);
		}
		if (body.is_public !== undefined) patch.is_public = body.is_public;

		const updated = await this.folders.merge(folderRid, patch);
		void this.audit.record({
			actorDid: did,
			action: 'folder_update',
			targetKind: 'folder',
			targetId: String(folderRid)
		});
		return this.toOwnedFolder(updated);
	}

	async deleteFolder(did: string, folderIdStr: string, deleteContents: boolean): Promise<void> {
		const folderRid = toFolderRecordId(folderIdStr);
		const folder = await this.folders.findById(folderRid);
		if (!folder || folder.owner_id !== did) throw new HttpException('Folder not found', 404);

		const descendantIds = await this.folders.getDescendantIds(folderRid);
		const allFolderIds = [folderRid, ...descendantIds];

		// Gather every filed upload up front (also serves the emptiness check).
		const fileGroups = await Promise.all(allFolderIds.map((f) => this.uploads.findByFolderId(f)));
		const files = fileGroups.flat();

		if (!deleteContents && (descendantIds.length > 0 || files.length > 0)) {
			throw new HttpException('Folder is not empty', 400);
		}

		// Files first (S3 object + row), then folders leaf → root.
		for (const f of files) {
			if (f.key) await this.storage.deleteObject(f.key);
			await this.uploads.delete(f.id);
		}
		for (const fid of [...descendantIds].reverse()) await this.folders.delete(fid);
		await this.folders.delete(folderRid);

		void this.audit.record({
			actorDid: did,
			action: 'folder_delete',
			targetKind: 'folder',
			targetId: String(folderRid),
			metadata: { deleted_files: files.length, deleted_folders: allFolderIds.length }
		});
	}

	// ── Files ───────────────────────────────────────────────────────────

	/**
	 * List library files. `folderId`: `undefined` = every folder; `null`/`''` =
	 * root (unfiled); a folder id string = that folder only.
	 */
	async listFiles(
		did: string,
		opts: {
			folderId?: string | null;
			search?: string;
			sort?: string;
			order?: 'asc' | 'desc';
			limit: number;
			offset: number;
		}
	): Promise<OwnedUploadsPage> {
		let folderRid: RecordId | null | undefined;
		if (opts.folderId === undefined) folderRid = undefined;
		else if (opts.folderId === null || opts.folderId === '') folderRid = null;
		else folderRid = toFolderRecordId(opts.folderId);

		const [rows, total] = await Promise.all([
			this.uploads.findLibraryByOwner(did, {
				folderId: folderRid,
				search: opts.search,
				sort: opts.sort ? { field: opts.sort, order: opts.order ?? 'desc' } : undefined,
				limit: opts.limit,
				offset: opts.offset
			}),
			this.uploads.countLibraryByOwner(did, { folderId: folderRid, search: opts.search })
		]);

		const breadcrumbs = folderRid ? (await this.folders.getFullPath(folderRid)).crumbs : [];
		return {
			data: rows.map((r) => this.toOwned(r)),
			breadcrumbs,
			pagination: {
				limit: opts.limit,
				offset: opts.offset,
				total,
				has_more: opts.offset + rows.length < total
			}
		};
	}

	/** Presigned PUT for a new library file. Key: uploads/{did}/library/{ulid}. */
	async presign(did: string, body: LibraryPresign) {
		if (body.size <= 0) throw new HttpException('File is empty', 400);

		// Per-file cap (instance-wide) first, then the per-account storage quota.
		await this.instanceConfig.assertFileSize(body.size);
		const limit = await this.instanceConfig.getStorageLimitBytes();
		const used = await this.uploads.sumCompletedSizeByDid(did);
		if (used + body.size > limit) {
			throw new HttpException('Storage limit exceeded', 413);
		}

		let folderRid: RecordId | null = null;
		let folderPublic = false;
		if (body.folder_id) {
			folderRid = toFolderRecordId(body.folder_id);
			const folder = await this.folders.findById(folderRid);
			if (!folder || folder.owner_id !== did) throw new HttpException('Folder not found', 400);
			folderPublic = !!folder.is_public;
		}
		const isPublic = body.is_public ?? folderPublic;

		const now = new Date();
		let row = await this.uploads.createWithCompositeId(did, {
			filename: body.filename,
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			metadata: body.metadata,
			folder_id: folderRid,
			status: 'pending',
			is_public: isPublic,
			is_story: false,
			created_at: now,
			updated_at: now
		});

		const localId = extractLocalId(row.id);
		const key = `uploads/${did}/library/${localId}`;
		const finalUrl = this.storage.buildUrl(key);
		row = await this.uploads.mergeByComposite(did, localId, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return {
			signed_url: signedUrl,
			final_url: finalUrl,
			upload_id: `${did}/${localId}`,
			did,
			local_id: localId,
			max_bytes: Math.max(0, limit - used)
		};
	}

	/** Verify the object landed in S3, re-check quota, then flip to completed. */
	async complete(did: string, localId: string, data: UploadComplete): Promise<OwnedUpload> {
		const row = await this.requireOwnFile(did, localId);
		if (row.status === 'completed') return this.toOwned(row);
		if (!row.key) throw new HttpException('Upload has no storage key', 409);

		const head = await this.storage.headObject(row.key);
		if (!head) throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		if (head.ContentLength !== row.size) {
			throw new HttpException(`Size mismatch: expected ${row.size}, got ${head.ContentLength}`, 400);
		}

		// Quota is only committed at completion; re-check against everything else
		// already completed (concurrent pendings could otherwise overshoot).
		const committed = await this.uploads.sumCompletedSizeByDid(did, localId);
		if (committed + row.size > (await this.instanceConfig.getStorageLimitBytes())) {
			await this.storage.deleteObject(row.key);
			await this.uploads.deleteByComposite(did, localId);
			throw new HttpException('Storage limit exceeded', 413);
		}

		const metadata: Record<string, unknown> = { ...(row.metadata ?? {}) };
		if (data.width && Number.isFinite(data.width)) metadata.width = Math.floor(data.width);
		if (data.height && Number.isFinite(data.height)) metadata.height = Math.floor(data.height);
		if (data.duration_seconds && Number.isFinite(data.duration_seconds)) {
			metadata.duration_seconds = Math.floor(data.duration_seconds);
		}

		const now = new Date();
		const updated = await this.uploads.mergeByComposite(did, localId, {
			status: 'completed',
			metadata,
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			updated_at: now
		});
		void this.audit.record({
			actorDid: did,
			action: 'upload_create',
			targetKind: 'upload',
			targetId: localId,
			metadata: { filename: updated.filename, size: updated.size, is_public: updated.is_public }
		});
		return this.toOwned(updated);
	}

	async patch(did: string, localId: string, body: UploadPatch): Promise<OwnedUpload> {
		const row = await this.requireOwnFile(did, localId);
		const patch: Partial<LibraryUploadRow> = { updated_at: new Date() };

		if (body.filename !== undefined) patch.filename = body.filename;
		if (body.is_public !== undefined) patch.is_public = body.is_public;
		if (body.folder_id !== undefined) {
			if (body.folder_id === null) {
				patch.folder_id = null;
			} else {
				const folderRid = toFolderRecordId(body.folder_id);
				const folder = await this.folders.findById(folderRid);
				if (!folder || folder.owner_id !== did) throw new HttpException('Folder not found', 400);
				patch.folder_id = folderRid;
			}
		}

		const updated = await this.uploads.mergeByComposite(did, localId, patch);
		void this.audit.record({
			actorDid: did,
			action: 'upload_update',
			targetKind: 'upload',
			targetId: localId
		});
		return this.toOwned(updated);
	}

	async remove(did: string, localId: string): Promise<void> {
		const row = await this.requireOwnFile(did, localId);
		await this.uploads.deleteByComposite(did, localId);
		if (row.key) await this.storage.deleteObject(row.key);
		void this.audit.record({
			actorDid: did,
			action: 'upload_delete',
			targetKind: 'upload',
			targetId: localId
		});
	}

	/**
	 * Time-boxed share link. Public files return their stable URL with a
	 * far-future expiry; private files get a presigned GET (60s–7d). Ported from
	 * syr's `getShareUrl`.
	 */
	async share(did: string, localId: string, expiresIn: number): Promise<ShareLinkResponse> {
		const row = await this.requireOwnFile(did, localId);
		if (row.status !== 'completed' || !row.key) {
			throw new HttpException('File is not ready to share', 400);
		}
		void this.audit.record({
			actorDid: did,
			action: 'upload_share',
			targetKind: 'upload',
			targetId: localId
		});

		if (row.is_public && row.url) {
			return {
				url: row.url,
				expiresAt: new Date(Date.now() + FAR_FUTURE_MS).toISOString(),
				isPublic: true
			};
		}
		const safe = Math.min(604800, Math.max(60, Math.floor(expiresIn)));
		const url = await this.storage.presignGet(row.key, safe);
		return {
			url,
			expiresAt: new Date(Date.now() + safe * 1000).toISOString(),
			isPublic: false
		};
	}

	// ── Helpers ─────────────────────────────────────────────────────────

	private async requireOwnFile(did: string, localId: string): Promise<LibraryUploadRow> {
		const row = await this.uploads.findByComposite(did, localId);
		if (!row) throw new HttpException('File not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this file', 403);
		if (row.is_story) throw new HttpException('Upload is a story, not a library file', 400);
		return row;
	}

	private toOwned(row: LibraryUploadRow): OwnedUpload {
		const meta = (row.metadata ?? {}) as Record<string, unknown>;
		const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			folder_id: row.folder_id ? String(row.folder_id) : null,
			filename: row.filename,
			mime_type: row.mime_type,
			size: row.size,
			url: row.url ?? null,
			status: row.status,
			is_public: !!row.is_public,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString(),
			width: num(meta.width),
			height: num(meta.height),
			duration_seconds: num(meta.duration_seconds)
		};
	}

	private async toOwnedFolder(row: FolderRow): Promise<OwnedFolder> {
		const { names } = await this.folders.getFullPath(row.id);
		return {
			id: String(row.id),
			name: row.name,
			parent_id: row.parent_id ? String(row.parent_id) : null,
			is_public: !!row.is_public,
			path: names,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
	}
}
