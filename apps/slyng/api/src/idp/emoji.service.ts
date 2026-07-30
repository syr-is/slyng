import { forwardRef, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	extractDid,
	extractLocalId,
	EMOJI_SHORTCODE_RE,
	EMOJI_ALLOWED_MIME,
	MAX_EMOJI_BYTES,
	type EmojiPresign,
	type EmojiComplete,
	type EmojiCopy,
	type OwnedEmoji
} from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { EmojiRepository, type EmojiRow } from './idp-media.repository';

/**
 * Owner-side custom-emoji lifecycle for local accounts: presign → PUT →
 * complete, plus list + delete. Mirrors the story flow (StoryService): the
 * shortcode + sticker flag are captured at presign, `complete` verifies the S3
 * object landed. Ownership is enforced from the composite key (no author_id).
 * Every mutation that changes the live emoji set broadcasts PROFILE_UPDATE +
 * records an IdP audit entry.
 */
@Injectable()
export class EmojiService {
	private readonly logger = new Logger(EmojiService.name);

	constructor(
		private readonly storage: IdpStorageService,
		private readonly emojis: EmojiRepository,
		private readonly audit: IdpAuditService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	/** Presigned PUT for a new emoji. Key: uploads/{did}/emojis/public/{ulid}. */
	async presign(did: string, body: EmojiPresign) {
		const shortcode = body.shortcode.trim();
		if (await this.emojis.shortcodeTaken(did, shortcode)) {
			throw new HttpException(`You already have an emoji :${shortcode}:`, 409);
		}
		const now = new Date();
		let row = await this.emojis.createWithCompositeId(did, {
			shortcode,
			is_sticker: !!body.is_sticker,
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			status: 'pending',
			created_at: now,
			updated_at: now
		});

		const localId = extractLocalId(row.id);
		const key = `uploads/${did}/emojis/public/${localId}`;
		const finalUrl = this.storage.buildUrl(key);
		row = await this.emojis.mergeByComposite(did, localId, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return { signed_url: signedUrl, final_url: finalUrl, did, local_id: localId };
	}

	/** Verify the object landed, then flip the emoji to completed (live). */
	async complete(did: string, localId: string, data: EmojiComplete): Promise<OwnedEmoji> {
		const row = await this.requireOwn(did, localId);
		if (row.status === 'completed') return this.toOwned(row);
		if (!row.key) throw new HttpException('Emoji has no storage key', 409);

		if (await this.emojis.shortcodeTaken(did, row.shortcode, localId)) {
			await this.emojis.deleteByComposite(did, localId);
			throw new HttpException(`You already have an emoji :${row.shortcode}:`, 409);
		}

		const head = await this.storage.headObject(row.key);
		if (!head) throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		if (head.ContentLength !== row.size) {
			throw new HttpException(`Size mismatch: expected ${row.size}, got ${head.ContentLength}`, 400);
		}

		const updated = await this.emojis.mergeByComposite(did, localId, {
			status: 'completed',
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			updated_at: new Date()
		});

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'emoji_create',
			targetKind: 'emoji',
			targetId: localId,
			metadata: { shortcode: updated.shortcode, is_sticker: updated.is_sticker }
		});
		this.logger.log(`Emoji published ${did.slice(0, 16)}…/:${updated.shortcode}:`);
		return this.toOwned(updated);
	}

	/**
	 * Click-to-add: copy an emoji seen in chat into the caller's own set. The
	 * server fetches the (public) source image, re-uploads it under the caller's
	 * DID, and registers it — as emoji or sticker — under `shortcode`. Only
	 * useful for local accounts (federated identities host emoji on their own
	 * instance); the client only surfaces the affordance for local users.
	 */
	async copyFromUrl(did: string, body: EmojiCopy): Promise<OwnedEmoji> {
		const shortcode = body.shortcode.trim();
		if (!EMOJI_SHORTCODE_RE.test(shortcode)) throw new HttpException('Invalid shortcode', 400);
		if (await this.emojis.shortcodeTaken(did, shortcode)) {
			throw new HttpException(`You already have an emoji :${shortcode}:`, 409);
		}
		const { buffer, mime } = await this.fetchImage(body.source_url);
		const now = new Date();
		let row = await this.emojis.createWithCompositeId(did, {
			shortcode,
			is_sticker: !!body.is_sticker,
			mime_type: mime,
			size: buffer.length,
			status: 'pending',
			created_at: now,
			updated_at: now
		});
		const localId = extractLocalId(row.id);
		const key = `uploads/${did}/emojis/public/${localId}`;
		await this.storage.putObjectBuffer(key, buffer, mime);
		row = await this.emojis.mergeByComposite(did, localId, {
			key,
			url: this.storage.buildUrl(key),
			status: 'completed',
			updated_at: new Date()
		});
		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'emoji_create',
			targetKind: 'emoji',
			targetId: localId,
			metadata: { shortcode, is_sticker: !!body.is_sticker, copied: true }
		});
		this.logger.log(`Emoji copied ${did.slice(0, 16)}…/:${shortcode}:`);
		return this.toOwned(row);
	}

	/** Internal docker service hostnames that must never be fetched (SSRF). */
	private static readonly BLOCKED_HOSTS = new Set([
		'localhost',
		'slyng-minio',
		'minio',
		'slyng-seaweedfs',
		'seaweedfs',
		'slyng-surrealdb',
		'surrealdb'
	]);

	/** IP-literal in a private / loopback / link-local (metadata) range. */
	private isBlockedIpLiteral(host: string): boolean {
		const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
		if (m) {
			const a = Number(m[1]);
			const b = Number(m[2]);
			if (a === 0 || a === 10 || a === 127) return true;
			if (a === 169 && b === 254) return true; // link-local + cloud metadata
			if (a === 172 && b >= 16 && b <= 31) return true;
			if (a === 192 && b === 168) return true;
			return false;
		}
		return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
	}

	/** Fetch a remote emoji image with an SSRF guard + mime/size caps. */
	private async fetchImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new HttpException('Invalid source URL', 400);
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new HttpException('Unsupported URL scheme', 400);
		}
		const host = parsed.hostname.toLowerCase();
		if (EmojiService.BLOCKED_HOSTS.has(host) || this.isBlockedIpLiteral(host)) {
			throw new HttpException('Source host not allowed', 400);
		}
		const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new HttpException(`Could not fetch source (${res.status})`, 400);
		const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (!(EMOJI_ALLOWED_MIME as readonly string[]).includes(mime)) {
			throw new HttpException('Source is not a supported image type', 400);
		}
		const declared = Number(res.headers.get('content-length') ?? '0');
		if (declared && declared > MAX_EMOJI_BYTES) throw new HttpException('Image too large', 400);
		const buffer = Buffer.from(await res.arrayBuffer());
		if (buffer.length > MAX_EMOJI_BYTES) throw new HttpException('Image too large', 400);
		return { buffer, mime };
	}

	async listOwn(did: string): Promise<OwnedEmoji[]> {
		const rows = await this.emojis.findAllByOwner(did);
		return rows.map((r) => this.toOwned(r));
	}

	async remove(did: string, localId: string): Promise<void> {
		const row = await this.requireOwn(did, localId);
		await this.emojis.deleteByComposite(did, localId);
		if (row.key) await this.storage.deleteObject(row.key);

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'emoji_delete',
			targetKind: 'emoji',
			targetId: localId,
			metadata: { shortcode: row.shortcode }
		});
	}

	private async requireOwn(did: string, localId: string): Promise<EmojiRow> {
		const row = await this.emojis.findByComposite(did, localId);
		if (!row) throw new HttpException('Emoji not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this emoji', 403);
		return row;
	}

	private toOwned(row: EmojiRow): OwnedEmoji {
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
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
}
