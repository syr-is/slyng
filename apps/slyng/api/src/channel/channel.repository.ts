import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { ChannelType } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Storage shapes for the channel tables. See `server.repository.ts` for why
 * these are separate from the `@slyng/types` wire schemas.
 *
 * DM channels live in this same table with `type: 'direct'` and no `server_id`,
 * which is why that link is optional — code branching on channel kind must check
 * `type` rather than assume a server scope.
 */

/**
 * Reuses the canonical `ChannelType` from `@slyng/types` rather than declaring a
 * local union — one source of truth, so adding a kind in the Rust schema
 * propagates here instead of silently diverging.
 */
export type ChannelRowType = ChannelType;

export interface ChannelRow extends Record<string, unknown> {
	id: RecordId;
	/** Absent for DM channels (`type: 'direct'`). */
	server_id?: RecordId;
	name?: string;
	type: ChannelRowType;
	topic?: string | null;
	position?: number;
	category_id?: RecordId | null;
	/** Drives DM list ordering; absent until the first message lands. */
	last_message_at?: Date | null;
	deleted?: boolean;
	deleted_at?: Date | null;
	deleted_by?: string | null;
	created_by?: string;
	created_at: Date;
	updated_at: Date;
}

export interface ChannelParticipantRow extends Record<string, unknown> {
	id: RecordId;
	channel_id: RecordId;
	/** Participant DID. */
	user_id: string;
	role?: string;
	joined_at: Date;
	created_at: Date;
	updated_at: Date;
}

export interface ChannelCategoryRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	name: string;
	position: number;
	created_at: Date;
	updated_at: Date;
}

export interface ChannelReadStateRow extends Record<string, unknown> {
	id: RecordId;
	/** Reader DID. */
	user_id: string;
	channel_id: RecordId;
	last_read_message_id?: RecordId;
	/** Persistent mention badge, restored on READY. */
	mention_count?: number;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class ChannelRepository extends BaseRepository<ChannelRow> {
	protected tableName = 'channel';
	constructor(db: DbService) { super(db); }

	/**
	 * Live (non-soft-deleted) channels for a server in sidebar order.
	 *
	 * `deleted = NONE OR deleted = false` rather than `deleted = false`: the
	 * column is absent on rows created before soft-delete existed, and a bare
	 * equality check would silently drop them.
	 */
	async findLiveByServer(serverRef: RecordId): Promise<ChannelRow[]> {
		const result = await this.db.query<[ChannelRow[]]>(
			`SELECT * FROM ${this.tableName}
			  WHERE server_id = $ref AND (deleted = NONE OR deleted = false)
			  ORDER BY position ASC`,
			{ ref: serverRef }
		);
		return result[0] ?? [];
	}

	/**
	 * The category a channel belongs to, or null when uncategorised. Narrow
	 * projection because permission resolution needs only this one column.
	 */
	async findCategoryId(channelRef: RecordId): Promise<RecordId | null> {
		const result = await this.db.query<[{ category_id?: RecordId | null }[]]>(
			`SELECT category_id FROM ${this.tableName} WHERE id = $id LIMIT 1`,
			{ id: channelRef }
		);
		return result[0]?.[0]?.category_id ?? null;
	}
}

@Injectable()
export class ChannelParticipantRepository extends BaseRepository<ChannelParticipantRow> {
	protected tableName = 'channel_participant';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ChannelCategoryRepository extends BaseRepository<ChannelCategoryRow> {
	protected tableName = 'channel_category';
	constructor(db: DbService) { super(db); }

	/** A server's categories in sidebar order. */
	async findByServerOrdered(serverRef: RecordId): Promise<ChannelCategoryRow[]> {
		const result = await this.db.query<[ChannelCategoryRow[]]>(
			`SELECT * FROM ${this.tableName} WHERE server_id = $ref ORDER BY position ASC`,
			{ ref: serverRef }
		);
		return result[0] ?? [];
	}
}

@Injectable()
export class ChannelReadStateRepository extends BaseRepository<ChannelReadStateRow> {
	protected tableName = 'channel_read_state';
	constructor(db: DbService) { super(db); }
}
