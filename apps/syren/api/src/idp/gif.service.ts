import { forwardRef, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { extractDid, extractLocalId, type GifPresign, type GifComplete, type OwnedGif } from '@syren/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { GifRepository, type GifRow } from './idp-media.repository';

/**
 * Owner-side personal-GIF lifecycle for local accounts: presign → PUT →
 * complete, plus list + delete. Mirrors EmojiService; GIFs carry `tags`
 * (lowercased for the public `search` filter) and an optional `thumbnail_url`.
 */
@Injectable()
export class GifService {
	private readonly logger = new Logger(GifService.name);

	constructor(
		private readonly storage: IdpStorageService,
		private readonly gifs: GifRepository,
		private readonly audit: IdpAuditService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	/** Presigned PUT for a new GIF. Key: uploads/{did}/gifs/public/{ulid}. */
	async presign(did: string, body: GifPresign) {
		const tags = (body.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
		const now = new Date();
		let row = await this.gifs.createWithCompositeId(did, {
			tags,
			thumbnail_url: null,
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			status: 'pending',
			created_at: now,
			updated_at: now
		});

		const localId = extractLocalId(row.id);
		const key = `uploads/${did}/gifs/public/${localId}`;
		const finalUrl = this.storage.buildUrl(key);
		row = await this.gifs.mergeByComposite(did, localId, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return { signed_url: signedUrl, final_url: finalUrl, did, local_id: localId };
	}

	/** Verify the object landed, then flip the GIF to completed (live). */
	async complete(did: string, localId: string, data: GifComplete): Promise<OwnedGif> {
		const row = await this.requireOwn(did, localId);
		if (row.status === 'completed') return this.toOwned(row);
		if (!row.key) throw new HttpException('GIF has no storage key', 409);

		const head = await this.storage.headObject(row.key);
		if (!head) throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		if (head.ContentLength !== row.size) {
			throw new HttpException(`Size mismatch: expected ${row.size}, got ${head.ContentLength}`, 400);
		}

		const updated = await this.gifs.mergeByComposite(did, localId, {
			status: 'completed',
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			...(data.thumbnail_url ? { thumbnail_url: data.thumbnail_url } : {}),
			updated_at: new Date()
		});

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'gif_create',
			targetKind: 'gif',
			targetId: localId,
			metadata: { tags: updated.tags }
		});
		this.logger.log(`GIF published ${did.slice(0, 16)}…/${localId}`);
		return this.toOwned(updated);
	}

	async listOwn(did: string): Promise<OwnedGif[]> {
		const rows = await this.gifs.findAllByOwner(did);
		return rows.map((r) => this.toOwned(r));
	}

	async remove(did: string, localId: string): Promise<void> {
		const row = await this.requireOwn(did, localId);
		await this.gifs.deleteByComposite(did, localId);
		if (row.key) await this.storage.deleteObject(row.key);

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'gif_delete',
			targetKind: 'gif',
			targetId: localId
		});
	}

	private async requireOwn(did: string, localId: string): Promise<GifRow> {
		const row = await this.gifs.findByComposite(did, localId);
		if (!row) throw new HttpException('GIF not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this GIF', 403);
		return row;
	}

	private toOwned(row: GifRow): OwnedGif {
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
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
