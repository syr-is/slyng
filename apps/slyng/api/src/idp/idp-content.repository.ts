import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { CompositeIdRepository } from '../db/composite.repository';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Owned uploads (stories now, general library in P7). Keyed on a composite
 * RecordId (`library_upload:{ created_by: <did>, id: <ulid> }`). Row shape
 * mirrors syr's `Upload` (apps/syr/app/src/lib/repositories/upload.repository.ts)
 * minus the fields P7 will add (share links, quota bookkeeping).
 */
export interface LibraryUploadRow extends Record<string, unknown> {
	id: RecordId;
	filename: string;
	mime_type: string;
	size: number;
	sha256?: string;
	metadata?: Record<string, unknown>;
	folder_id?: RecordId | null;
	key?: string;
	url?: string | null;
	status: 'pending' | 'finalizing' | 'completed' | 'failed';
	is_public: boolean;
	is_story: boolean;
	published_at?: Date | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class LibraryUploadRepository extends CompositeIdRepository<LibraryUploadRow> {
	protected tableName = 'library_upload';
	constructor(db: DbService) {
		super(db);
	}

	/**
	 * Active stories for a DID within the 24h window, oldest → newest.
	 * Port of syr's `findActiveStoriesByDid`: public + completed + a live URL,
	 * flagged as a story with a fresh `published_at`. Capped at 200 slides.
	 */
	async findActiveStoriesByDid(did: string, since: Date): Promise<LibraryUploadRow[]> {
		const result = await this.db.query<[LibraryUploadRow[]]>(
			`SELECT * FROM library_upload
			 WHERE id.created_by = $did
			   AND is_public = true
			   AND status = 'completed'
			   AND url != NONE
			   AND key != NONE
			   AND is_story = true
			   AND published_at != NONE
			   AND published_at >= $since`,
			{ did, since }
		);
		const rows = result[0] ?? [];
		const effectiveTime = (u: LibraryUploadRow) =>
			(u.published_at ? new Date(u.published_at) : new Date(u.updated_at)).getTime();
		return rows.sort((a, b) => effectiveTime(a) - effectiveTime(b)).slice(0, 200);
	}

	/** Every story the owner has (any status) — for the owner-facing manager. */
	async findAllStoriesByDid(did: string): Promise<LibraryUploadRow[]> {
		return this.findByOwnerDid(did, {
			filters: { is_story: true },
			sort: { field: 'created_at', order: 'desc' }
		});
	}

	// ── Library files (P7): non-story uploads the user manages directly ──

	private static readonly SORTABLE = new Set(['created_at', 'updated_at', 'filename', 'size']);

	/**
	 * Library files for a DID (`is_story = false`), with optional folder scope
	 * and filename search. `folderId` semantics mirror syr's route: `undefined`
	 * = every folder; `null` = the root (unfiled); a RecordId = that folder only.
	 */
	async findLibraryByOwner(
		did: string,
		options: {
			folderId?: RecordId | null;
			search?: string;
			sort?: { field: string; order: 'asc' | 'desc' };
			limit?: number;
			offset?: number;
		} = {}
	): Promise<LibraryUploadRow[]> {
		const { where, vars } = this.libraryWhere(did, options);
		const field = LibraryUploadRepository.SORTABLE.has(options.sort?.field ?? '')
			? options.sort!.field
			: 'created_at';
		const order = (options.sort?.order ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
		const limit =
			options.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
		const start =
			options.offset !== undefined ? `START ${Math.max(0, Math.floor(options.offset))}` : '';
		const result = await this.db.query<[LibraryUploadRow[]]>(
			`SELECT * FROM library_upload WHERE ${where} ORDER BY ${field} ${order} ${limit} ${start}`,
			vars
		);
		return result[0] ?? [];
	}

	async countLibraryByOwner(
		did: string,
		options: { folderId?: RecordId | null; search?: string } = {}
	): Promise<number> {
		const { where, vars } = this.libraryWhere(did, options);
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM library_upload WHERE ${where} GROUP ALL`,
			vars
		);
		return result[0]?.[0]?.total ?? 0;
	}

	private libraryWhere(
		did: string,
		options: { folderId?: RecordId | null; search?: string }
	): { where: string; vars: Record<string, unknown> } {
		const clauses = ['id.created_by = $did', 'is_story = false'];
		const vars: Record<string, unknown> = { did };
		if (options.folderId !== undefined) {
			clauses.push('folder_id = $folderId');
			vars.folderId = options.folderId; // null → root, RecordId → that folder
		}
		const q = options.search?.trim().toLowerCase();
		if (q) {
			clauses.push('string::lowercase(filename) CONTAINS $q');
			vars.q = q;
		}
		return { where: clauses.join(' AND '), vars };
	}

	/** Every upload filed directly under a folder (for recursive folder delete). */
	async findByFolderId(folderId: RecordId): Promise<LibraryUploadRow[]> {
		const result = await this.db.query<[LibraryUploadRow[]]>(
			`SELECT * FROM library_upload WHERE folder_id = $fid`,
			{ fid: folderId }
		);
		return result[0] ?? [];
	}

	/** Public library files for a DID — the federation surface (is_story=false). */
	async findPublicByDidPage(
		did: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<LibraryUploadRow[]> {
		const limit =
			options.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
		const start =
			options.offset !== undefined ? `START ${Math.max(0, Math.floor(options.offset))}` : '';
		const result = await this.db.query<[LibraryUploadRow[]]>(
			`SELECT * FROM library_upload
			 WHERE id.created_by = $did AND is_public = true AND status = 'completed'
			   AND url != NONE AND is_story = false
			 ORDER BY created_at DESC ${limit} ${start}`,
			{ did }
		);
		return result[0] ?? [];
	}

	async countPublicByDid(did: string): Promise<number> {
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM library_upload
			 WHERE id.created_by = $did AND is_public = true AND status = 'completed'
			   AND url != NONE AND is_story = false GROUP ALL`,
			{ did }
		);
		return result[0]?.[0]?.total ?? 0;
	}

	/**
	 * Sum of completed bytes (library + stories) for a DID — the storage-usage
	 * counter, computed straight from the table (slyng has no KV usage cache).
	 * `excludeLocalId` omits one row so a completing upload can be quota-checked
	 * against everything already committed.
	 */
	async sumCompletedSizeByDid(did: string, excludeLocalId?: string): Promise<number> {
		const extra = excludeLocalId ? 'AND id.id != $exclude' : '';
		const result = await this.db.query<[{ total: number | null }[]]>(
			`SELECT math::sum(size) AS total FROM library_upload
			 WHERE id.created_by = $did AND status = 'completed' ${extra} GROUP ALL`,
			{ did, ...(excludeLocalId ? { exclude: excludeLocalId } : {}) }
		);
		return Math.max(0, result[0]?.[0]?.total ?? 0);
	}

	/** Completed-upload byte total + file count for a DID (admin user table). */
	async statsByDid(did: string): Promise<{ bytes: number; files: number }> {
		const result = await this.db.query<[{ bytes: number | null; files: number }[]]>(
			`SELECT math::sum(size) AS bytes, count() AS files FROM library_upload
			 WHERE id.created_by = $did AND status = 'completed' GROUP ALL`,
			{ did }
		);
		const row = result[0]?.[0];
		return { bytes: Math.max(0, row?.bytes ?? 0), files: row?.files ?? 0 };
	}
}

/**
 * Minimal folder table (P4). Full path hierarchy + visibility arrives in P7;
 * for now it exists so story keys can nest under a `stories/{day}/public`
 * logical path without a schema migration later.
 */
export interface FolderRow extends Record<string, unknown> {
	id: RecordId;
	owner_id: string;
	name: string;
	parent_id?: RecordId | null;
	is_public?: boolean;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class FolderRepository extends BaseRepository<FolderRow> {
	protected tableName = 'folder';
	constructor(db: DbService) {
		super(db);
	}

	async findOrCreate(
		ownerId: string,
		name: string,
		parentId: RecordId | null,
		isPublic = false
	): Promise<FolderRow> {
		const existing = await this.findOne({
			owner_id: ownerId,
			name,
			parent_id: parentId
		});
		if (existing) return existing;
		const now = new Date();
		return this.create({
			owner_id: ownerId,
			name,
			parent_id: parentId,
			is_public: isPublic,
			created_at: now,
			updated_at: now
		});
	}

	/** Folders directly under `parentId` (null = root), name-sorted. */
	async findByParent(ownerId: string, parentId: RecordId | null): Promise<FolderRow[]> {
		const result = await this.db.query<[FolderRow[]]>(
			`SELECT * FROM folder WHERE owner_id = $owner AND parent_id = $parent ORDER BY name ASC`,
			{ owner: ownerId, parent: parentId }
		);
		return result[0] ?? [];
	}

	/** Whether `name` already exists directly under `parentId` for this owner. */
	async siblingExists(
		ownerId: string,
		name: string,
		parentId: RecordId | null,
		exceptId?: RecordId
	): Promise<boolean> {
		const siblings = await this.findByParent(ownerId, parentId);
		return siblings.some((f) => f.name === name && String(f.id) !== String(exceptId ?? ''));
	}

	/**
	 * Folder-name chain from root → this folder, plus `{id,name}` breadcrumbs.
	 * Walks `parent_id` upward (guarded against cycles).
	 */
	async getFullPath(
		folderId: RecordId
	): Promise<{ names: string[]; crumbs: { id: string; name: string }[] }> {
		const crumbs: { id: string; name: string }[] = [];
		let current: RecordId | null = folderId;
		let guard = 0;
		while (current && guard++ < 64) {
			const row: FolderRow | null = await this.findById(current);
			if (!row) break;
			crumbs.unshift({ id: String(row.id), name: row.name });
			current = (row.parent_id as RecordId | null) ?? null;
		}
		return { names: crumbs.map((c) => c.name), crumbs };
	}

	/** All descendant folder ids (for recursive delete + circular-move guards). */
	async getDescendantIds(folderId: RecordId): Promise<RecordId[]> {
		const out: RecordId[] = [];
		const stack: RecordId[] = [folderId];
		let guard = 0;
		while (stack.length && guard++ < 10000) {
			const parent = stack.pop() as RecordId;
			const children = await this.db.query<[FolderRow[]]>(
				`SELECT id FROM folder WHERE parent_id = $parent`,
				{ parent }
			);
			for (const c of children[0] ?? []) {
				out.push(c.id);
				stack.push(c.id);
			}
		}
		return out;
	}
}
