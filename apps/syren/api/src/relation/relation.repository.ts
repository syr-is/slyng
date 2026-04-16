import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';
import type { Friendship, UserBlock, UserIgnore } from '@syren/types';

@Injectable()
export class FriendshipRepository extends BaseRepository<Friendship> {
	protected tableName = 'friendship';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class UserBlockRepository extends BaseRepository<UserBlock> {
	protected tableName = 'user_block';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class UserIgnoreRepository extends BaseRepository<UserIgnore> {
	protected tableName = 'user_ignore';
	constructor(db: DbService) { super(db); }
}
