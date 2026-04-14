import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class ServerRepository extends BaseRepository {
	protected tableName = 'server';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerMemberRepository extends BaseRepository {
	protected tableName = 'server_member';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerRoleRepository extends BaseRepository {
	protected tableName = 'server_role';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class ServerInviteRepository extends BaseRepository {
	protected tableName = 'server_invite';
	constructor(db: DbService) { super(db); }
}
