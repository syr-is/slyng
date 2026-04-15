import type { Surreal, RecordId } from 'surrealdb';
import { stringToRecordId } from '@syren/types';
import { DbService } from './db.service';

/**
 * Base Repository
 * Generic CRUD over a SurrealDB table using SDK methods (db.select, db.merge, db.delete, db.create).
 * All repositories extend this. Services compose repositories — they do not run raw queries.
 */
export abstract class BaseRepository<T extends Record<string, unknown> = Record<string, unknown>> {
	protected abstract tableName: string;

	constructor(protected readonly dbService: DbService) {}

	protected get db(): Surreal {
		return this.dbService.getDb();
	}

	protected toRecordId(id: RecordId | string): RecordId {
		return typeof id === 'string' ? stringToRecordId.decode(id) : id;
	}

	// ── CREATE ──

	async create(data: Partial<T>): Promise<T> {
		const result = await this.db.create(this.tableName, data as Record<string, unknown>);
		return (Array.isArray(result) ? result[0] : result) as T;
	}

	async createWithId(id: RecordId | string, data: Partial<T>): Promise<T> {
		const recordId = this.toRecordId(id);
		const result = await this.db.create(recordId, data as Record<string, unknown>);
		return (Array.isArray(result) ? result[0] : result) as T;
	}

	// ── READ ──

	async findById(id: RecordId | string): Promise<T | null> {
		const recordId = this.toRecordId(id);
		const record = await this.db.select(recordId);
		return (record ?? null) as T | null;
	}

	async findOne(filters: Record<string, unknown>): Promise<T | null> {
		const conditions = Object.keys(filters)
			.map((key) => `${key} = $${key}`)
			.join(' AND ');
		const result = await this.db.query<[T[]]>(
			`SELECT * FROM ${this.tableName} WHERE ${conditions} LIMIT 1`,
			filters
		);
		return result[0]?.[0] ?? null;
	}

	/**
	 * Build `WHERE …` predicate + query-param bag for a filter/search combo.
	 * Returns an empty string when there's nothing to filter by.
	 *
	 *  - `filters`: `key = $key` AND-joined
	 *  - `search` : `(field1 ~ $__q OR field2 ~ $__q …)` appended under AND,
	 *    case-insensitive via SurrealDB's fuzzy-match operator (`~`).
	 */
	protected buildWhere(
		filters: Record<string, unknown> = {},
		search?: { fields: string[]; query: string }
	): { where: string; bindings: Record<string, unknown> } {
		const bindings: Record<string, unknown> = { ...filters };
		const clauses: string[] = Object.keys(filters).map((key) => `${key} = $${key}`);

		const q = search?.query?.trim();
		if (q && search?.fields?.length) {
			bindings.__q = q.toLowerCase();
			const inner = search.fields.map((f) => `string::lowercase(${f}) CONTAINS $__q`).join(' OR ');
			clauses.push(`(${inner})`);
		}
		return {
			where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
			bindings
		};
	}

	async findMany(
		filters: Record<string, unknown> = {},
		options: {
			sort?: { field: string; order?: 'asc' | 'desc' };
			limit?: number;
			offset?: number;
			search?: { fields: string[]; query: string };
		} = {}
	): Promise<T[]> {
		const { where, bindings } = this.buildWhere(filters, options.search);
		const order = options.sort
			? `ORDER BY ${options.sort.field} ${(options.sort.order ?? 'asc').toUpperCase()}`
			: '';
		const limit = options.limit !== undefined ? `LIMIT ${options.limit}` : '';
		const start = options.offset !== undefined ? `START ${options.offset}` : '';
		const sql = [`SELECT * FROM ${this.tableName}`, where, order, limit, start]
			.filter(Boolean)
			.join(' ');
		const result = await this.db.query<[T[]]>(sql, bindings);
		return result[0] ?? [];
	}

	/**
	 * Paginated fetch with optional sort + multi-field fuzzy search.
	 * Returns both the requested page and the total matching count in parallel.
	 * Reused by admin tables (invites, members, messages pins, etc).
	 */
	async findPage(
		filters: Record<string, unknown> = {},
		options: {
			sort?: { field: string; order?: 'asc' | 'desc' };
			limit?: number;
			offset?: number;
			search?: { fields: string[]; query: string };
		} = {}
	): Promise<{ items: T[]; total: number }> {
		const limit = Math.min(options.limit ?? 50, 200);
		const offset = options.offset ?? 0;

		const [items, total] = await Promise.all([
			this.findMany(filters, { sort: options.sort, limit, offset, search: options.search }),
			this.count(filters, options.search)
		]);
		return { items, total };
	}

	async findByIds(ids: (RecordId | string)[]): Promise<T[]> {
		if (!ids.length) return [];
		const recordIds = ids.map((id) => this.toRecordId(id));
		const result = await this.db.query<[T[]]>(
			`SELECT * FROM ${this.tableName} WHERE id IN $ids`,
			{ ids: recordIds }
		);
		return result[0] ?? [];
	}

	async exists(id: RecordId | string): Promise<boolean> {
		const record = await this.findById(id);
		return record !== null;
	}

	async count(
		filters: Record<string, unknown> = {},
		search?: { fields: string[]; query: string }
	): Promise<number> {
		const { where, bindings } = this.buildWhere(filters, search);
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM ${this.tableName} ${where} GROUP ALL`,
			bindings
		);
		return result[0]?.[0]?.total ?? 0;
	}

	// ── UPDATE ──

	async merge(id: RecordId | string, data: Partial<T>): Promise<T> {
		const recordId = this.toRecordId(id);
		const record = await this.db.merge(recordId, data as Record<string, unknown>);
		return record as T;
	}

	async update(id: RecordId | string, data: Partial<T>): Promise<T> {
		return this.merge(id, data);
	}

	async mergeWhere(filters: Record<string, unknown>, data: Partial<T>): Promise<T[]> {
		const conditions = Object.keys(filters)
			.map((key) => `${key} = $${key}`)
			.join(' AND ');
		const result = await this.db.query<[T[]]>(
			`UPDATE ${this.tableName} MERGE $data WHERE ${conditions}`,
			{ ...filters, data }
		);
		return result[0] ?? [];
	}

	// ── DELETE ──

	async delete(id: RecordId | string): Promise<void> {
		const recordId = this.toRecordId(id);
		await this.db.delete(recordId);
	}

	async deleteWhere(filters: Record<string, unknown>): Promise<void> {
		const conditions = Object.keys(filters)
			.map((key) => `${key} = $${key}`)
			.join(' AND ');
		await this.db.query(
			`DELETE ${this.tableName} WHERE ${conditions}`,
			filters
		);
	}
}
