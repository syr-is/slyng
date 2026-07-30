import { randomUUID } from 'node:crypto';
import { forwardRef, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { EmojiPresign, EmojiComplete, GifPresign, GifComplete } from '@slyng/types';
import { WsOp } from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import { IdpStorageService } from '../idp/idp-storage.service';
import {
	ServerEmojiRepository,
	ServerGifRepository,
	type ServerEmojiRow,
	type ServerGifRow
} from './server-media.repository';

/** A server's custom sets are capped so pickers/manifests stay bounded. */
export const MAX_SERVER_EMOJIS = 250;
export const MAX_SERVER_GIFS = 250;

/**
 * Server-owned emoji/sticker + GIF hosting. Server-native (not federated):
 * objects live under `servers/{serverId}/…/public/{ulid}` and rows are keyed by
 * `server_id`, so every member reads the set while `MANAGE_EMOJIS` gates writes
 * (enforced at the route). Lifecycle mirrors the IdP media flow: presign → PUT
 * → complete (HeadObject verify). Each mutation broadcasts `SERVER_EMOJI_UPDATE`
 * to the server topic + writes a server audit entry.
 */
@Injectable()
export class ServerMediaService {
	private readonly logger = new Logger(ServerMediaService.name);

	constructor(
		private readonly emojis: ServerEmojiRepository,
		private readonly gifs: ServerGifRepository,
		private readonly storage: IdpStorageService,
		private readonly audit: AuditLogService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	private keyPrefix(serverId: string, kind: 'emojis' | 'gifs'): string {
		const safe = serverId.replace(/[^a-zA-Z0-9]+/g, '_');
		return `servers/${safe}/${kind}/public`;
	}

	private notify(serverId: string): void {
		this.gateway?.emitToServer(serverId, {
			op: WsOp.SERVER_EMOJI_UPDATE,
			d: { server_id: serverId }
		});
	}

	// ── Emoji ──────────────────────────────────────────────────────────────

	async presignEmoji(serverId: string, actorId: string, body: EmojiPresign) {
		const shortcode = body.shortcode.trim();
		if (await this.emojis.shortcodeTaken(serverId, shortcode)) {
			throw new HttpException(`This server already has an emoji :${shortcode}:`, 409);
		}
		if ((await this.emojis.countCompleted(serverId)) >= MAX_SERVER_EMOJIS) {
			throw new HttpException(`This server has reached the ${MAX_SERVER_EMOJIS}-emoji limit`, 409);
		}
		const now = new Date();
		const row = await this.emojis.create({
			server_id: serverId,
			shortcode,
			is_sticker: !!body.is_sticker,
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			status: 'pending',
			created_by: actorId,
			created_at: now,
			updated_at: now
		});
		const id = String(row.id);
		const key = `${this.keyPrefix(serverId, 'emojis')}/${randomUUID()}`;
		const finalUrl = this.storage.buildUrl(key);
		await this.emojis.merge(id, { key, url: finalUrl, updated_at: new Date() });
		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return { signed_url: signedUrl, final_url: finalUrl, id, server_id: serverId };
	}

	async completeEmoji(serverId: string, actorId: string, id: string, data: EmojiComplete) {
		const row = await this.requireEmoji(serverId, id);
		if (row.status === 'completed') return this.toEmoji(row);
		if (!row.key) throw new HttpException('Emoji has no storage key', 409);
		if (await this.emojis.shortcodeTaken(serverId, row.shortcode, id)) {
			await this.emojis.delete(id);
			throw new HttpException(`This server already has an emoji :${row.shortcode}:`, 409);
		}
		const head = await this.storage.headObject(row.key);
		if (!head) throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		if (head.ContentLength !== row.size) {
			throw new HttpException(
				`Size mismatch: expected ${row.size}, got ${head.ContentLength}`,
				400
			);
		}
		const updated = await this.emojis.merge(id, {
			status: 'completed',
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			updated_at: new Date()
		});
		this.notify(serverId);
		void this.audit.record({
			serverId,
			actorId,
			action: 'emoji_create',
			targetKind: 'emoji',
			targetId: id,
			metadata: { shortcode: updated.shortcode, is_sticker: updated.is_sticker }
		});
		this.logger.log(`Server emoji published ${serverId}/:${updated.shortcode}:`);
		return this.toEmoji(updated);
	}

	async listEmojis(serverId: string) {
		const rows = await this.emojis.listCompleted(serverId);
		return rows.map((r) => this.toEmoji(r));
	}

	async removeEmoji(serverId: string, actorId: string, id: string): Promise<void> {
		const row = await this.requireEmoji(serverId, id);
		await this.emojis.delete(id);
		if (row.key) await this.storage.deleteObject(row.key);
		this.notify(serverId);
		void this.audit.record({
			serverId,
			actorId,
			action: 'emoji_delete',
			targetKind: 'emoji',
			targetId: id,
			metadata: { shortcode: row.shortcode }
		});
	}

	// ── GIF ────────────────────────────────────────────────────────────────

	async presignGif(serverId: string, actorId: string, body: GifPresign) {
		if ((await this.gifs.countCompleted(serverId)) >= MAX_SERVER_GIFS) {
			throw new HttpException(`This server has reached the ${MAX_SERVER_GIFS}-GIF limit`, 409);
		}
		const now = new Date();
		const row = await this.gifs.create({
			server_id: serverId,
			tags: (body.tags ?? []).map((t) => t.toLowerCase()),
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			status: 'pending',
			created_by: actorId,
			created_at: now,
			updated_at: now
		});
		const id = String(row.id);
		const key = `${this.keyPrefix(serverId, 'gifs')}/${randomUUID()}`;
		const finalUrl = this.storage.buildUrl(key);
		await this.gifs.merge(id, { key, url: finalUrl, updated_at: new Date() });
		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return { signed_url: signedUrl, final_url: finalUrl, id, server_id: serverId };
	}

	async completeGif(serverId: string, actorId: string, id: string, data: GifComplete) {
		const row = await this.requireGif(serverId, id);
		if (row.status === 'completed') return this.toGif(row);
		if (!row.key) throw new HttpException('GIF has no storage key', 409);
		const head = await this.storage.headObject(row.key);
		if (!head) throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		if (head.ContentLength !== row.size) {
			throw new HttpException(
				`Size mismatch: expected ${row.size}, got ${head.ContentLength}`,
				400
			);
		}
		const updated = await this.gifs.merge(id, {
			status: 'completed',
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			...(data.thumbnail_url ? { thumbnail_url: data.thumbnail_url } : {}),
			updated_at: new Date()
		});
		this.notify(serverId);
		void this.audit.record({
			serverId,
			actorId,
			action: 'gif_create',
			targetKind: 'gif',
			targetId: id,
			metadata: { tags: updated.tags }
		});
		return this.toGif(updated);
	}

	async listGifs(serverId: string) {
		const rows = await this.gifs.listCompleted(serverId);
		return rows.map((r) => this.toGif(r));
	}

	async removeGif(serverId: string, actorId: string, id: string): Promise<void> {
		const row = await this.requireGif(serverId, id);
		await this.gifs.delete(id);
		if (row.key) await this.storage.deleteObject(row.key);
		this.notify(serverId);
		void this.audit.record({
			serverId,
			actorId,
			action: 'gif_delete',
			targetKind: 'gif',
			targetId: id,
			metadata: { tags: row.tags }
		});
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	private async requireEmoji(serverId: string, id: string): Promise<ServerEmojiRow> {
		const row = await this.emojis.findById(id);
		if (!row || row.server_id !== serverId) throw new HttpException('Emoji not found', 404);
		return row;
	}

	private async requireGif(serverId: string, id: string): Promise<ServerGifRow> {
		const row = await this.gifs.findById(id);
		if (!row || row.server_id !== serverId) throw new HttpException('GIF not found', 404);
		return row;
	}

	private toEmoji(row: ServerEmojiRow) {
		return {
			id: String(row.id),
			server_id: row.server_id,
			shortcode: row.shortcode,
			url: row.url ?? null,
			is_sticker: row.is_sticker,
			mime_type: row.mime_type,
			size: row.size,
			status: row.status,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
	}

	private toGif(row: ServerGifRow) {
		return {
			id: String(row.id),
			server_id: row.server_id,
			url: row.url ?? null,
			thumbnail_url: row.thumbnail_url ?? null,
			tags: row.tags ?? [],
			mime_type: row.mime_type,
			size: row.size,
			status: row.status,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
	}
}
