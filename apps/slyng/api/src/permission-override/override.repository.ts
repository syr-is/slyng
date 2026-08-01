import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { PermissionScopeType, PermissionTargetType } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Storage shape for the permission-override table. See `server.repository.ts`
 * for why these row shapes are separate from the `@slyng/types` wire schemas:
 * `PermissionOverride` types every link as a `string` because that is what the
 * client sees after `RecordIdInterceptor` serialises it, but the row itself
 * carries `RecordId` links and `Date` instants.
 *
 * Getting that wrong is not cosmetic here — this table feeds the permission
 * cascade, and a caller that believed `scope_id` was a string would hand it to
 * `stringToRecordId.encode`, whose output side is `z.instanceof(RecordId)`, and
 * take a ZodError on an authorisation path.
 */
export interface PermissionOverrideRow extends Record<string, unknown> {
	id: RecordId;
	server_id: RecordId;
	scope_type: PermissionScopeType;
	/** Absent/null for server-scoped overrides. */
	scope_id?: RecordId | null;
	target_type: PermissionTargetType;
	/** Encoded role record id for `role` targets; a member DID for `user` targets. */
	target_id: string;
	/** Decimal bitmask strings — SurrealDB has no type that survives a u64 round trip. */
	allow: string;
	deny: string;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class PermissionOverrideRepository extends BaseRepository<PermissionOverrideRow> {
	protected tableName = 'permission_override';
	constructor(db: DbService) { super(db); }
}
