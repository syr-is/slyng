import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class AuditLogRepository extends BaseRepository {
	protected tableName = 'audit_log';
	constructor(db: DbService) {
		super(db);
	}
}
