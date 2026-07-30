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
}

@Injectable()
export class ChannelReadStateRepository extends BaseRepository<ChannelReadStateRow> {
	protected tableName = 'channel_read_state';
	constructor(db: DbService) { super(db); }
}
