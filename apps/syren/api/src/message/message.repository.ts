import { Injectable } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

@Injectable()
export class MessageRepository extends BaseRepository {
	protected tableName = 'message';
	constructor(db: DbService) { super(db); }

	/**
	 * Channel-message page query with an optional `created_at < $before`
	 * cutoff baked into the WHERE clause. The infinite-scroll-up
	 * pagination needs the cutoff to apply to the SELECT itself, not
	 * to a post-fetch JS filter — otherwise the DB always returns the
	 * latest N messages and the in-memory filter trims them all
	 * because the caller's `before` is the oldest of those N.
	 */
	async findByChannelBefore(
		channelRef: RecordId,
		options: { before?: Date; limit?: number } = {}
	) {
		const limit = options.limit ?? 50;
		const bindings: Record<string, unknown> = { channel_id: channelRef };
		const clauses: string[] = ['channel_id = $channel_id'];
		if (options.before) {
			bindings.before = options.before;
			clauses.push('created_at < $before');
		}
		const sql = `SELECT * FROM ${this.tableName} WHERE ${clauses.join(
			' AND '
		)} ORDER BY created_at DESC LIMIT ${limit}`;
		const result = await this.db.query<[any[]]>(sql, bindings);
		return result[0] ?? [];
	}
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
