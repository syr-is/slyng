import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Identity rows. Deliberately thin: slyng stores the DID and home-instance URL
 * only — display name, avatar, banner, stories and emoji are resolved from the
 * user's syr manifest at read time and never persisted here (AI.md rule 8).
 * If you are about to add a profile column, don't.
 */
export interface UserRow extends Record<string, unknown> {
	id: RecordId;
	did: string;
	syr_instance_url?: string;
	/** DM privacy preference; absent means the instance default applies. */
	allow_dms?: string;
	allow_friend_requests?: string;
	trusted_domains?: string[];
	created_at: Date;
	updated_at: Date;
}

/** Delegated platform sessions (`platform:*` tokens), not browser sessions. */
export interface PlatformSessionRow extends Record<string, unknown> {
	id: RecordId;
	user_id: string;
	expires_at?: Date;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class UserRepository extends BaseRepository<UserRow> {
	protected tableName = 'user';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class PlatformSessionRepository extends BaseRepository<PlatformSessionRow> {
	protected tableName = 'platform_session';
	constructor(db: DbService) { super(db); }
}
