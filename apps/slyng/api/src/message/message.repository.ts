import { Injectable } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import type { Attachment, Embed } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Storage shapes for the message tables. See `server.repository.ts` for why
 * these are separate from the `@slyng/types` wire schemas.
 */

export interface MessageRow extends Record<string, unknown> {
	id: RecordId;
	channel_id: RecordId;
	/** Author DID. */
	sender_id: string;
	sender_instance_url?: string;
	content: string;
	attachments?: Attachment[];
	embeds?: Embed[];
	/**
	 * Validated mention set resolved at write time — recipient DIDs plus the
	 * literal `'everyone'`. Drives the inbox and `mentions:` search, so it is
	 * already permission-filtered and must not be recomputed from content.
	 */
	mentions?: string[];
	pinned?: boolean;
	pinned_at?: Date;
	pinned_by?: string;
	reply_to?: RecordId[];
	/** Soft delete — the row is retained and masked for unprivileged readers. */
	deleted?: boolean;
	deleted_at?: Date | null;
	deleted_by?: string | null;
	edited_at?: Date | null;
	created_at: Date;
	updated_at: Date;
}

export interface MessageReactionRow extends Record<string, unknown> {
	id: RecordId;
	message_id: RecordId;
	/** Reactor DID. */
	user_id: string;
	value: string;
	kind?: string;
	image_url?: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface PinnedMessageRow extends Record<string, unknown> {
	id: RecordId;
	channel_id: RecordId;
	message_id: RecordId;
	pinned_at: Date;
	pinned_by: string;
	created_at: Date;
	updated_at: Date;
}

/** Server-wide search predicates. Channel scoping is the caller's job. */
export interface MessageSearchFilters {
	q?: string;
	sender_id?: string;
	mentions?: string;
	pinned?: boolean;
	since?: Date;
	until?: Date;
}

@Injectable()
export class MessageRepository extends BaseRepository<MessageRow> {
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
	): Promise<MessageRow[]> {
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
		const result = await this.db.query<[MessageRow[]]>(sql, bindings);
		return result[0] ?? [];
	}

	/**
	 * Non-deleted messages in `channelRefs` matching the SQL-expressible
	 * predicates, newest first. `has:` filtering needs attachment/embed
	 * introspection and stays in the service.
	 *
	 * Soft-deleted rows are excluded here rather than masked, so search can
	 * never surface removed content regardless of the caller's permissions.
	 */
	async searchInChannels(
		channelRefs: RecordId[],
		filters: MessageSearchFilters = {}
	): Promise<MessageRow[]> {
		if (!channelRefs.length) return [];
		const bindings: Record<string, unknown> = { channels: channelRefs };
		const where = ['channel_id IN $channels', '(deleted = NONE OR deleted = false)'];
		if (filters.q?.trim()) {
			bindings.q = filters.q.trim().toLowerCase();
			where.push('string::lowercase(content) CONTAINS $q');
		}
		if (filters.sender_id?.trim()) {
			bindings.sender = filters.sender_id.trim();
			where.push('sender_id = $sender');
		}
		if (filters.mentions?.trim()) {
			bindings.mention = filters.mentions.trim();
			where.push('mentions CONTAINS $mention');
		}
		if (filters.pinned) where.push('pinned = true');
		if (filters.since) {
			bindings.since = filters.since;
			where.push('created_at >= $since');
		}
		if (filters.until) {
			bindings.until = filters.until;
			where.push('created_at <= $until');
		}
		const result = await this.db.query<[MessageRow[]]>(
			`SELECT * FROM ${this.tableName} WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
			bindings
		);
		return result[0] ?? [];
	}

	/**
	 * Messages in `channelRefs` that mention `did` (directly or via
	 * `@everyone`), newest first, excluding the reader's own. Bounded by
	 * `limit` in SQL — the inbox never needs the full history.
	 */
	async findMentioning(
		channelRefs: RecordId[],
		did: string,
		limit = 500
	): Promise<MessageRow[]> {
		if (!channelRefs.length) return [];
		const result = await this.db.query<[MessageRow[]]>(
			`SELECT * FROM ${this.tableName}
			  WHERE channel_id IN $channels
			    AND (deleted = NONE OR deleted = false)
			    AND sender_id != $self
			    AND (mentions CONTAINS $self OR mentions CONTAINS $everyone)
			  ORDER BY created_at DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
			{ channels: channelRefs, self: did, everyone: 'everyone' }
		);
		return result[0] ?? [];
	}
}

@Injectable()
export class MessageReactionRepository extends BaseRepository<MessageReactionRow> {
	protected tableName = 'message_reaction';
	constructor(db: DbService) { super(db); }
}

@Injectable()
export class PinnedMessageRepository extends BaseRepository<PinnedMessageRow> {
	protected tableName = 'pinned_message';
	constructor(db: DbService) { super(db); }
}
