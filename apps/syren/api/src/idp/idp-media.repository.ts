import { Injectable } from '@nestjs/common';
import type { RecordId, Surreal } from 'surrealdb';
import type { EmojiStatus, GifStatus } from '@syren/types';
import { CompositeIdRepository } from '../db/composite.repository';
import { DbService } from '../db/db.service';

/**
 * Custom-emoji and GIF hosting (P6), each keyed on a composite RecordId
 * (`emoji:{ created_by, id }` / `gif:{ created_by, id }`). Ownership lives in
 * the key — no `author_id` — so every query filters the indexed
 * `id.created_by`. Row shapes mirror syr's emoji/gif tables, minus the
 * `scope`/`pack_slug` columns (syren is single-tenant: all rows are the user's).
 * Unlike syr's single-step URL register, syren uploads via presign→complete, so
 * rows carry a `key`/`status` through the pending→completed lifecycle.
 */

export interface EmojiRow extends Record<string, unknown> {
	id: RecordId;
	shortcode: string;
	url?: string;
	is_sticker: boolean;
	key?: string;
	mime_type: string;
	size: number;
	sha256?: string;
	status: EmojiStatus;
	created_at: Date;
	updated_at: Date;
}

export interface GifRow extends Record<string, unknown> {
	id: RecordId;
	url?: string;
	thumbnail_url?: string | null;
	tags: string[];
	key?: string;
	mime_type: string;
	size: number;
	sha256?: string;
	status: GifStatus;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class EmojiRepository extends CompositeIdRepository<EmojiRow> {
	protected tableName = 'emoji';
	constructor(db: DbService) {
		super(db);
	}

	/** Every emoji the owner has (any status), newest first. */
	async findAllByOwner(did: string): Promise<EmojiRow[]> {
		return this.findByOwnerDid(did, { sort: { field: 'created_at', order: 'desc' } });
	}

	/** Whether the owner already has a live emoji under this shortcode. */
	async shortcodeTaken(did: string, shortcode: string, exceptLocalId?: string): Promise<boolean> {
		const rows = await this.findByOwnerDid(did, { filters: { shortcode } });
		return rows.some((r) => r.status === 'completed' && r.id.id !== exceptLocalId);
	}

	/** Public emoji list — completed only, ordered by shortcode (syr's order). */
	async findPublicByDid(
		did: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ data: EmojiRow[]; total: number }> {
		const filters = { status: 'completed' };
		const [data, total] = await Promise.all([
			this.findByOwnerDid(did, {
				filters,
				sort: { field: 'shortcode', order: 'asc' },
				limit: options.limit,
				offset: options.offset
			}),
			this.countByOwnerDid(did, filters)
		]);
		return { data, total };
	}

	/** Change-detection digest for the public hash: `e:${count}:${latest}`. */
	async digestByDid(did: string): Promise<{ count: number; latestUpdatedAt: string | null }> {
		return digest(this.db, 'emoji', did);
	}
}

@Injectable()
export class GifRepository extends CompositeIdRepository<GifRow> {
	protected tableName = 'gif';
	constructor(db: DbService) {
		super(db);
	}

	async findAllByOwner(did: string): Promise<GifRow[]> {
		return this.findByOwnerDid(did, { sort: { field: 'created_at', order: 'desc' } });
	}

	/**
	 * Public GIF list — completed only, newest first, with an optional `search`
	 * over tags (SurrealDB `tags CONTAINS $q`, matched case-insensitively by
	 * lowercasing at write + query time).
	 */
	async findPublicByDid(
		did: string,
		options: { limit?: number; offset?: number; search?: string } = {}
	): Promise<{ data: GifRow[]; total: number }> {
		const q = options.search?.trim().toLowerCase();
		if (!q) {
			const filters = { status: 'completed' };
			const [data, total] = await Promise.all([
				this.findByOwnerDid(did, {
					filters,
					sort: { field: 'created_at', order: 'desc' },
					limit: options.limit,
					offset: options.offset
				}),
				this.countByOwnerDid(did, filters)
			]);
			return { data, total };
		}
		const limit = options.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
		const start = options.offset !== undefined ? `START ${Math.max(0, Math.floor(options.offset))}` : '';
		const where = `id.created_by = $did AND status = 'completed' AND tags CONTAINS $q`;
		const [rows, counted] = await Promise.all([
			this.db.query<[GifRow[]]>(
				`SELECT * FROM gif WHERE ${where} ORDER BY created_at DESC ${limit} ${start}`,
				{ did, q }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM gif WHERE ${where} GROUP ALL`,
				{ did, q }
			)
		]);
		return { data: rows[0] ?? [], total: counted[0]?.[0]?.total ?? 0 };
	}

	/** Change-detection digest for the public hash: `g:${count}:${latest}`. */
	async digestByDid(did: string): Promise<{ count: number; latestUpdatedAt: string | null }> {
		return digest(this.db, 'gif', did);
	}
}

/** Shared count + latest-updated digest over completed rows for a DID. */
async function digest(
	db: Surreal,
	table: 'emoji' | 'gif',
	did: string
): Promise<{ count: number; latestUpdatedAt: string | null }> {
	const result = await db.query<[{ cnt: number; latest: string | Date | null }[]]>(
		`SELECT count() AS cnt, math::max(updated_at) AS latest
		 FROM ${table}
		 WHERE id.created_by = $did AND status = 'completed'
		 GROUP ALL`,
		{ did }
	);
	const row = result[0]?.[0];
	if (!row) return { count: 0, latestUpdatedAt: null };
	return {
		count: row.cnt ?? 0,
		latestUpdatedAt: row.latest ? new Date(row.latest).toISOString() : null
	};
}
