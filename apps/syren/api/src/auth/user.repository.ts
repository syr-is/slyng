import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class UserRepository extends BaseRepository {
	protected tableName = 'user';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class PlatformSessionRepository extends BaseRepository {
	protected tableName = 'platform_session';
	constructor(db: DbService) { super(db); }
}
