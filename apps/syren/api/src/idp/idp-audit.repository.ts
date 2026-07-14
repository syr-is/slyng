import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/** One instance-level identity audit entry (profile/asset/story/… mutation). */
export interface IdpAuditRow extends Record<string, unknown> {
	id: RecordId;
	actor_did: string;
	action: string;
	target_kind: string;
	target_id: string | null;
	metadata: Record<string, unknown>;
	created_at: Date;
}

@Injectable()
export class IdpAuditRepository extends BaseRepository<IdpAuditRow> {
	protected tableName = 'idp_audit_log';
	constructor(db: DbService) {
		super(db);
	}

	async listForActor(
		actorDid: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ items: IdpAuditRow[]; total: number }> {
		return this.findPage(
			{ actor_did: actorDid },
			{ sort: { field: 'created_at', order: 'desc' }, limit: options.limit, offset: options.offset }
		);
	}
}
