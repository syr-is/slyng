import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Voice presence. Ephemeral by design — hard-deleted on leave/disconnect
 * (AI.md rule 4), so there is no soft-delete bookkeeping here.
 */
export interface VoiceStateRow extends Record<string, unknown> {
	id: RecordId;
	/** Speaker DID. */
	user_id: string;
	// Nulled rather than removed when the user leaves a channel but keeps a row.
	channel_id?: RecordId | null;
	server_id?: RecordId | null;
	self_mute?: boolean;
	self_deaf?: boolean;
	joined_at?: Date;
	updated_at: Date;
}

@Injectable()
export class VoiceStateRepository extends BaseRepository<VoiceStateRow> {
	protected tableName = 'voice_state';
	constructor(db: DbService) { super(db); }
}
