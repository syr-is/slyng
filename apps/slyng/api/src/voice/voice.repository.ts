import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class VoiceStateRepository extends BaseRepository {
	protected tableName = 'voice_state';
	constructor(db: DbService) { super(db); }
}
