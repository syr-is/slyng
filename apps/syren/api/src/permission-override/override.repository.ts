import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';
import type { PermissionOverride } from '@syren/types';

@Injectable()
export class PermissionOverrideRepository extends BaseRepository<PermissionOverride> {
	protected tableName = 'permission_override';
	constructor(db: DbService) { super(db); }
}
