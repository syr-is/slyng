import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';
import { createKvRecordId } from '@slyng/types';
import { DbService } from '../db/db.service';

export interface KvEntry {
	id: unknown;
	kv_type: string;
	value: unknown;
	expires_at?: Date;
	created_at: Date;
	updated_at: Date;
}

/**
 * Generic KV store over the `kv` table with record ids `kv:<type>:<index>`.
 * Port of syr's kv.repository.ts + kv.service.ts (collapsed into one
 * injectable — the syr service was a pure delegation layer). Used for
 * instance config, invite codes, and pending-delegation state.
 */
@Injectable()
export class KvService {
	private readonly logger = new Logger(KvService.name);

	/** Valid identifier names, safe to interpolate into SurrealQL. */
	private static readonly VALID_FIELD_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

	constructor(private readonly dbService: DbService) {}

	private get db() {
		return this.dbService.getDb();
	}

	private isExpired(entry: KvEntry): boolean {
		return !!entry.expires_at && new Date(entry.expires_at) < new Date();
	}

	async set(type: string, index: string, value: unknown, ttlSeconds?: number): Promise<void> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();
		const expiresAt = ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000) : undefined;
		await this.db.query(
			`UPSERT $recordId SET
				kv_type = $type,
				value = $value,
				created_at = created_at ?? $now,
				updated_at = $now${expiresAt ? ', expires_at = $expiresAt' : ''}`,
			{ recordId, type, value, now, ...(expiresAt ? { expiresAt } : {}) }
		);
	}

	async getEntry(type: string, index: string): Promise<KvEntry | null> {
		const recordId = createKvRecordId(type, index);
		const record = (await this.db.select(recordId).catch(() => null)) as KvEntry | null;
		if (!record) return null;
		if (this.isExpired(record)) {
			await this.delete(type, index);
			return null;
		}
		return record;
	}

	async get<T = unknown>(type: string, index: string): Promise<T | null> {
		const entry = await this.getEntry(type, index);
		return entry ? (entry.value as T) : null;
	}

	async has(type: string, index: string): Promise<boolean> {
		return (await this.getEntry(type, index)) !== null;
	}

	async delete(type: string, index: string): Promise<void> {
		const recordId = createKvRecordId(type, index);
		await this.db.delete(recordId).catch(() => undefined);
	}

	/**
	 * Atomically delete an entry ONLY when the given `value.<field>` conditions
	 * all match, returning the value (or null if it didn't match / was gone).
	 * Single-use consume without a get→check→delete TOCTOU window, and — unlike
	 * an unconditional delete — a non-matching guess (e.g. wrong code) leaves the
	 * entry intact, so it can't be used to grief the legitimate consumer.
	 */
	async consumeMatching<T = unknown>(
		type: string,
		index: string,
		match: Record<string, unknown>
	): Promise<T | null> {
		const entries = Object.entries(match).filter(([, v]) => v !== undefined);
		for (const [field] of entries) {
			if (!KvService.VALID_FIELD_REGEX.test(field)) {
				throw new Error(`Invalid field name: "${field}"`);
			}
		}
		const recordId = createKvRecordId(type, index);
		const conds = entries.map(([k]) => `value.${k} = $m_${k}`).join(' AND ');
		const params: Record<string, unknown> = { recordId };
		for (const [k, v] of entries) params[`m_${k}`] = v;
		const where = conds ? `WHERE ${conds}` : '';
		const result = await this.db.query<[KvEntry[]]>(
			`DELETE $recordId ${where} RETURN BEFORE`,
			params
		);
		const record = result[0]?.[0];
		if (!record) return null;
		if (this.isExpired(record)) return null;
		return record.value as T;
	}

	/** Atomically get a value and delete the entry. Prevents TOCTOU races. */
	async getAndDelete<T = unknown>(type: string, index: string): Promise<T | null> {
		const recordId = createKvRecordId(type, index);
		const result = await this.db.query<[KvEntry[]]>(`DELETE $recordId RETURN BEFORE`, {
			recordId
		});
		const record = result[0]?.[0];
		if (!record) return null;
		if (this.isExpired(record)) return null;
		return record.value as T;
	}

	async findByType(type: string): Promise<KvEntry[]> {
		const result = await this.db.query<[KvEntry[]]>(
			`SELECT * FROM kv WHERE kv_type = $type AND (expires_at = NONE OR expires_at >= time::now())`,
			{ type }
		);
		return result[0] ?? [];
	}

	async findByTypePage(
		type: string,
		limit = 20,
		offset = 0
	): Promise<{ data: KvEntry[]; total: number }> {
		const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
		const safeOffset = Math.max(0, Math.trunc(offset));
		const [dataResult, countResult] = await Promise.all([
			this.db.query<[KvEntry[]]>(
				`SELECT * FROM kv WHERE kv_type = $type AND (expires_at = NONE OR expires_at >= time::now()) ORDER BY id ASC LIMIT $limit START $offset`,
				{ type, limit: safeLimit, offset: safeOffset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM kv WHERE kv_type = $type AND (expires_at = NONE OR expires_at >= time::now()) GROUP ALL`,
				{ type }
			)
		]);
		return { data: dataResult[0] ?? [], total: countResult[0]?.[0]?.total ?? 0 };
	}

	async deleteByType(type: string): Promise<void> {
		await this.db.query(`DELETE FROM kv WHERE kv_type = $type`, { type });
	}

	/**
	 * Create an entry only if absent — a single INSERT attempt; duplicate-id
	 * errors mean it already existed (atomic, no check-then-insert race).
	 */
	async createIfAbsent(type: string, index: string, value: unknown): Promise<boolean> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();
		try {
			await this.db.query(
				`INSERT INTO kv { id: $recordId, kv_type: $type, value: $value, created_at: $now, updated_at: $now };`,
				{ recordId, type, value, now }
			);
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('Database record')) {
				return false;
			}
			throw err;
		}
	}

	/**
	 * Atomically increment a numeric field within the value object inside a
	 * DB transaction. Throws 'QUOTA_EXCEEDED' when maxValue would be
	 * exceeded. Port of syr's kv.repository.ts atomicIncrementField.
	 */
	async atomicIncrementField(
		type: string,
		index: string,
		field: string,
		amount: number,
		minValue?: number,
		maxValue?: number,
		ttlSeconds?: number
	): Promise<number> {
		if (!KvService.VALID_FIELD_REGEX.test(field)) {
			throw new Error(`Invalid field name: "${field}"`);
		}
		if (ttlSeconds != null && ttlSeconds < 0) {
			throw new Error('ttlSeconds must be non-negative');
		}
		const recordId = createKvRecordId(type, index);
		const now = new Date();
		const expiresAt = ttlSeconds != null ? new Date(now.getTime() + ttlSeconds * 1000) : undefined;
		const expiresAtSet = expiresAt !== undefined ? ', expires_at = $expiresAt' : '';

		const guard =
			maxValue !== undefined
				? `IF $proposed > $maxValue {
						THROW "QUOTA_EXCEEDED";
					};`
				: '';
		const newVal =
			minValue !== undefined
				? maxValue !== undefined
					? `math::max([<int> $minValue, <int> math::min([<int> $maxValue, <int> $proposed])])`
					: `math::max([<int> $minValue, <int> $proposed])`
				: `$proposed`;

		const query = `
			BEGIN TRANSACTION;
			LET $record = SELECT * FROM ONLY $recordId;
			LET $current = IF $record != NONE AND ($record.expires_at IS NONE OR $record.expires_at > $now) { $record.value.${field} ?? 0 } ELSE { 0 };
			LET $proposed = $current + $amount;
			LET $newVal = ${newVal};
			${guard}
			UPSERT $recordId SET
				kv_type = $type,
				value.${field} = $newVal,
				created_at = created_at ?? $now,
				updated_at = $now${expiresAtSet};
			COMMIT TRANSACTION;
			RETURN $newVal;
		`;

		try {
			const params: Record<string, unknown> = {
				recordId,
				type,
				amount,
				minValue: minValue ?? 0,
				maxValue: maxValue ?? Number.MAX_SAFE_INTEGER,
				now
			};
			if (expiresAt !== undefined) params.expiresAt = expiresAt;

			const result = await this.db.query<[unknown]>(query, params);
			// The RETURN lands at a result position that varies with the
			// statement mix; scan back-to-front for the first number.
			for (let i = result.length - 1; i >= 0; i--) {
				const item = result[i];
				if (typeof item === 'number') return item;
				if (Array.isArray(item) && typeof item[0] === 'number') return item[0];
			}
			throw new Error(
				`atomicIncrementField: unexpected SurrealDB response shape for ${String(recordId)}.${field}`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('QUOTA_EXCEEDED')) throw new Error('QUOTA_EXCEEDED');
			throw err;
		}
	}

	/** Periodic TTL sweep (syr runs the same job from hooks.server.ts). */
	@Interval(120_000)
	async cleanupExpired(): Promise<void> {
		try {
			await this.db.query(`DELETE FROM kv WHERE expires_at != NONE AND expires_at < time::now()`);
		} catch (err) {
			this.logger.warn(`kv TTL sweep failed: ${err instanceof Error ? err.message : err}`);
		}
	}
}
