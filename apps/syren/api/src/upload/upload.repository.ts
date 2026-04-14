import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class UploadRepository extends BaseRepository {
	protected tableName = 'upload';
	constructor(db: DbService) { super(db); }
}
