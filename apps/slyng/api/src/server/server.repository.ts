import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Storage shapes for the server tables.
 *
 * These are the *row* shapes, deliberately distinct from the wire schemas in
 * `@slyng/types` (`ServerSchema` et al): rows carry `RecordId` links and `Date`
 * instants where the wire carries strings, plus internal columns the API never
 * serialises (soft-delete bookkeeping, the split allow/deny permission masks).
 *
 * Permission masks are `string`, not `bigint` — SurrealDB has no 64-bit-unsigned
 * type that survives the round trip, so they are stored as decimal strings and
 * parsed with `BigInt(...)` at the edges.
 *
 * Each extends `Record<string, unknown>` to satisfy `BaseRepository`'s
 * constraint. That leaves an index signature, so an undeclared column reads as
 * `unknown` rather than `any` — unsafe use still fails to compile.
 */

export interface ServerRow extends Record<string, unknown> {
	id: RecordId;
	name: string;
	// `null` (not absent) is how these are cleared — SurrealDB `merge` ignores
	// `undefined`, so the services write an explicit null to unset a field.
	description?: string | null;
	icon_url?: string | null;
	banner_url?: string | null;
	invite_background_url?: string | null;
	/** Owner DID — an identity string, not a record link. */
	owner_id: string;
	member_count: number;
	created_at: Date;
	updated_at: Date;
}

export interface ServerMemberRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	/** Member DID. */
	user_id: string;
	role_ids: RecordId[];
	nickname?: string | null;
	joined_at: Date;
	created_at: Date;
	updated_at: Date;
}

export interface ServerRoleRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	name: string;
	color?: string | null;
	/** Legacy single mask; superseded by the allow/deny pair but still read as a fallback. */
	permissions?: string;
	permissions_allow?: string;
	permissions_deny?: string;
	position: number;
	is_default?: boolean;
	deleted?: boolean;
	deleted_at?: Date | null;
	deleted_by?: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface ServerInviteRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	code: string;
	created_by: string;
	label?: string | null;
	max_uses?: number;
	uses: number;
	/** Absent/null means never expires. */
	expires_at?: Date | null;
	role_ids?: RecordId[];
	target_kind?: string;
	target_value?: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface ServerBanRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	user_id: string;
	reason?: string | null;
	/** Bans are soft: `false` means unbanned, with the history preserved. */
	active: boolean;
	banned_at: Date;
	banned_by: string;
	unbanned_at?: Date | null;
	unbanned_by?: string | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class ServerRepository extends BaseRepository<ServerRow> {
	protected tableName = 'server';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerMemberRepository extends BaseRepository<ServerMemberRow> {
	protected tableName = 'server_member';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerRoleRepository extends BaseRepository<ServerRoleRow> {
	protected tableName = 'server_role';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerInviteRepository extends BaseRepository<ServerInviteRow> {
	protected tableName = 'server_invite';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerBanRepository extends BaseRepository<ServerBanRow> {
	protected tableName = 'server_ban';
	constructor(db: DbService) { super(db); }
}
