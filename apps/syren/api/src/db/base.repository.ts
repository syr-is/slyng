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

	async findMany(
		filters: Record<string, unknown> = {},
		options: {
			sort?: { field: string; order?: 'asc' | 'desc' };
			limit?: number;
			offset?: number;
		} = {}
	): Promise<T[]> {
		const conditions = Object.keys(filters)
			.map((key) => `${key} = $${key}`)
			.join(' AND ');
		const where = conditions ? `WHERE ${conditions}` : '';
		const order = options.sort
			? `ORDER BY ${options.sort.field} ${(options.sort.order ?? 'asc').toUpperCase()}`
			: '';
		const limit = options.limit !== undefined ? `LIMIT ${options.limit}` : '';
		const start = options.offset !== undefined ? `START ${options.offset}` : '';
		const sql = [`SELECT * FROM ${this.tableName}`, where, order, limit, start]
			.filter(Boolean)
			.join(' ');
		const result = await this.db.query<[T[]]>(sql, filters);
		return result[0] ?? [];
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

	async count(filters: Record<string, unknown> = {}): Promise<number> {
		const conditions = Object.keys(filters)
			.map((key) => `${key} = $${key}`)
			.join(' AND ');
		const where = conditions ? `WHERE ${conditions}` : '';
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM ${this.tableName} ${where} GROUP ALL`,
			filters
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
