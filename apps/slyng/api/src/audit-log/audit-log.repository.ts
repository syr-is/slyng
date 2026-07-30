import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { AuditAction, AuditTargetKind } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Audit trail. Append-only: entries are never updated or deleted, so there is
 * no soft-delete bookkeeping. `AuditLogService.record()` is the single write
 * point (AI.md rule 3).
 */
export interface AuditLogRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	/** Actor DID. */
	actor_id: string;
	action: AuditAction;
	target_kind: AuditTargetKind;
	target_id?: string | null;
	/** Set when the target is a user, so member actions can be filtered by victim. */
	target_user_id?: string | null;
	channel_id?: RecordId | string | null;
	/** Free-form per-action detail; shape varies by `action`. */
	metadata?: Record<string, unknown>;
	reason?: string | null;
	/** Groups the entries emitted by one bulk operation (e.g. a purge). */
	batch_id?: string | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class AuditLogRepository extends BaseRepository<AuditLogRow> {
	protected tableName = 'audit_log';
	constructor(db: DbService) {
		super(db);
	}
}
