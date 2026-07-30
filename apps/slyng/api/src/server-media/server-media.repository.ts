import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { EmojiStatus, GifStatus } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Server-owned emoji/sticker + GIF sets. Unlike the per-user IdP `emoji`/`gif`
 * tables (composite `{created_by, id}` keys, federated per-DID), these are
 * server-native: a plain auto-id row carrying a `server_id` string. Every
 * member reads a server's set (`GET /servers/:id/emojis`); `MANAGE_EMOJIS`
 * gates writes. Rows carry a `key`/`status` through the presign→complete
 * lifecycle, same as the IdP media tables.
 */

export interface ServerEmojiRow extends Record<string, unknown> {
	id: RecordId;
	server_id: string;
	shortcode: string;
	url?: string;
	is_sticker: boolean;
	key?: string;
	mime_type: string;
	size: number;
	sha256?: string;
	status: EmojiStatus;
	created_by: string;
	created_at: Date;
	updated_at: Date;
}

export interface ServerGifRow extends Record<string, unknown> {
	id: RecordId;
	server_id: string;
	url?: string;
	thumbnail_url?: string | null;
	tags: string[];
	key?: string;
	mime_type: string;
	size: number;
	sha256?: string;
	status: GifStatus;
	created_by: string;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class ServerEmojiRepository extends BaseRepository<ServerEmojiRow> {
	protected tableName = 'server_emoji';
	constructor(db: DbService) {
		super(db);
	}

	/** Live emoji in a server, ordered by shortcode (any status for owners → filter). */
	listCompleted(serverId: string): Promise<ServerEmojiRow[]> {
		return this.findMany(
			{ server_id: serverId, status: 'completed' },
			{ sort: { field: 'shortcode', order: 'asc' } }
		);
	}

	countCompleted(serverId: string): Promise<number> {
		return this.count({ server_id: serverId, status: 'completed' });
	}

	/** Whether the server already has a live emoji under this shortcode. */
	async shortcodeTaken(serverId: string, shortcode: string, exceptId?: string): Promise<boolean> {
		const rows = await this.findMany({ server_id: serverId, shortcode });
		return rows.some((r) => r.status === 'completed' && String(r.id) !== exceptId);
	}
}

@Injectable()
export class ServerGifRepository extends BaseRepository<ServerGifRow> {
	protected tableName = 'server_gif';
	constructor(db: DbService) {
		super(db);
	}

	/** Live GIFs in a server, newest first. Sets are ≤250, so tag search (if any)
	 *  is a cheap in-memory filter by the caller, not a SurrealDB array query. */
	listCompleted(serverId: string): Promise<ServerGifRow[]> {
		return this.findMany(
			{ server_id: serverId, status: 'completed' },
			{ sort: { field: 'created_at', order: 'desc' } }
		);
	}

	countCompleted(serverId: string): Promise<number> {
		return this.count({ server_id: serverId, status: 'completed' });
	}
}
