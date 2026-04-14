import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class MessageRepository extends BaseRepository {
	protected tableName = 'message';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class MessageReactionRepository extends BaseRepository {
	protected tableName = 'message_reaction';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class PinnedMessageRepository extends BaseRepository {
	protected tableName = 'pinned_message';
	constructor(db: DbService) { super(db); }
}
