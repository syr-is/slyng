import { RecordId } from 'surrealdb';
import {
	createOwnedRecordId,
	recordIdFromDidAndLocal,
	extractDid,
	extractLocalId
} from '@slyng/types';
import { BaseRepository } from './base.repository';

/**
 * Repository for owned/portable content keyed on a composite RecordId
 * (`table:{ created_by: <did>, id: <ulid> }`). Ports syr's
 * `createWithCompositeId` / `createWithExplicitId` helpers and adds the
 * DID-scoped query/mutation methods every hosting phase (stories, posts,
 * emojis, uploads) needs.
 *
 * SurrealDB indexes the composite id's inner fields — `id.created_by` and
 * `id.id` are directly queryable — so ownership filters never scan the table.
 */
export abstract class CompositeIdRepository<
	T extends Record<string, unknown> = Record<string, unknown>
> extends BaseRepository<T> {
	/** Create with a fresh ULID under the owner DID. */
	async createWithCompositeId(did: string, data: Partial<T>): Promise<T> {
		const recordId = createOwnedRecordId(this.tableName, did);
		const result = await this.db.create(recordId, data as Record<string, unknown>);
		return (Array.isArray(result) ? result[0] : result) as T;
	}

	/**
	 * Create with an explicit local id — used during import to preserve the
	 * original ULID from the source instance (keeps cross-instance links).
	 */
	async createWithExplicitId(did: string, localId: string, data: Partial<T>): Promise<T> {
		const recordId = createOwnedRecordId(this.tableName, did, localId);
		const result = await this.db.create(recordId, data as Record<string, unknown>);
		return (Array.isArray(result) ? result[0] : result) as T;
	}

	/** Rebuild the composite key from URL params (`:did/:id`). */
	compositeId(did: string, localId: string): RecordId {
		return recordIdFromDidAndLocal(this.tableName, did, localId);
	}

	async findByComposite(did: string, localId: string): Promise<T | null> {
		const record = await this.db.select(this.compositeId(did, localId));
		return (record ?? null) as T | null;
	}

	async mergeByComposite(did: string, localId: string, data: Partial<T>): Promise<T> {
		const record = await this.db.merge(
			this.compositeId(did, localId),
			data as Record<string, unknown>
		);
		return record as T;
	}

	async deleteByComposite(did: string, localId: string): Promise<void> {
		await this.db.delete(this.compositeId(did, localId));
	}

	/**
	 * All records owned by a DID, newest first. Filters on the indexed
	 * `id.created_by` field, plus any extra equality filters.
	 */
	async findByOwnerDid(
		did: string,
		options: {
			filters?: Record<string, unknown>;
			sort?: { field: string; order?: 'asc' | 'desc' };
			limit?: number;
			offset?: number;
		} = {}
	): Promise<T[]> {
		const filters = options.filters ?? {};
		const clauses = ['id.created_by = $__did', ...Object.keys(filters).map((k) => `${k} = $${k}`)];
		const order = options.sort
			? `ORDER BY ${options.sort.field} ${(options.sort.order ?? 'desc').toUpperCase()}`
			: 'ORDER BY created_at DESC';
		const limit = options.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
		const start = options.offset !== undefined ? `START ${Math.max(0, Math.floor(options.offset))}` : '';
		const sql = [
			`SELECT * FROM ${this.tableName}`,
			`WHERE ${clauses.join(' AND ')}`,
			order,
			limit,
			start
		]
			.filter(Boolean)
			.join(' ');
		const result = await this.db.query<[T[]]>(sql, { __did: did, ...filters });
		return result[0] ?? [];
	}

	async countByOwnerDid(did: string, filters: Record<string, unknown> = {}): Promise<number> {
		const clauses = ['id.created_by = $__did', ...Object.keys(filters).map((k) => `${k} = $${k}`)];
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM ${this.tableName} WHERE ${clauses.join(' AND ')} GROUP ALL`,
			{ __did: did, ...filters }
		);
		return result[0]?.[0]?.total ?? 0;
	}

	/**
	 * Flatten a composite RecordId row for the wire: add `did` + `local_id`
	 * so consumers can build `/:did/:id` URLs without re-parsing the key.
	 * (The raw composite `id` is still emitted in object form by
	 * `serializeForWire`.)
	 */
	protected withCompositeFields<R extends { id: RecordId }>(
		row: R
	): R & { did: string; local_id: string } {
		return { ...row, did: extractDid(row.id), local_id: extractLocalId(row.id) };
	}
}
