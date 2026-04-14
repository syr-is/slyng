import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class ChannelRepository extends BaseRepository {
	protected tableName = 'channel';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ChannelParticipantRepository extends BaseRepository {
	protected tableName = 'channel_participant';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ChannelCategoryRepository extends BaseRepository {
	protected tableName = 'channel_category';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ChannelReadStateRepository extends BaseRepository {
	protected tableName = 'channel_read_state';
	constructor(db: DbService) { super(db); }
}
