import {
	forwardRef,
	HttpException,
	Inject,
	Injectable,
	Logger,
	Optional
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	extractDid,
	extractLocalId,
	ulid,
	type MediaDisplayMode,
	type OwnedPost,
	type PostAssetPresign,
	type PostCreate,
	type PostType,
	type PostUpdate
} from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { InstanceConfigService } from './instance-config.service';
import { PlatformService } from './platform.service';
import { PostRepository, type PostRow } from './idp-post.repository';

const POST_ASSET_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'video/mp4',
	'video/webm'
]);
const MAX_POST_ASSET_BYTES = 50 * 1024 * 1024;
const DEFAULT_DISPLAY_MODE: MediaDisplayMode = 'masonry';

/**
 * Owned blog/media posts for local accounts (P5). CRUD + post-asset presign,
 * with server-side content signing via the account's self-delegation key —
 * the same signing-as-a-service path `ProfileService` uses for `profile@v1`.
 * Every mutation broadcasts PROFILE_UPDATE (so connected clients re-resolve)
 * and records an IdP audit entry. Public reads live in `IdpPublicService`.
 */
@Injectable()
export class PostService {
	private readonly logger = new Logger(PostService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly storage: IdpStorageService,
		private readonly posts: PostRepository,
		private readonly platform: PlatformService,
		private readonly audit: IdpAuditService,
		private readonly instanceConfig: InstanceConfigService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	private publicUrl(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	// ── owner CRUD ──

	async create(did: string, body: PostCreate): Promise<OwnedPost> {
		const now = new Date();
		const data = this.buildTypeFields(body.type, {
			content_type: body.content_type,
			content: body.content,
			media_urls: body.media_urls,
			display_mode: body.display_mode
		});
		if (body.title?.trim()) data.title = body.title.trim();
		if (body.description?.trim()) data.description = body.description.trim();
		data.type = body.type;
		data.visibility = body.visibility;
		data.status = body.status;
		data.created_at = now;
		data.updated_at = now;

		let row = body.post_local_id
			? await this.posts.createWithExplicitId(did, body.post_local_id, data)
			: await this.posts.createWithCompositeId(did, data);

		const localId = extractLocalId(row.id);
		const signed = await this.signPost(did, localId, row);
		if (signed) row = await this.posts.mergeByComposite(did, localId, { ...signed });

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'post_create',
			targetKind: 'post',
			targetId: localId,
			metadata: { type: row.type, status: row.status }
		});
		this.logger.log(`Post created ${did.slice(0, 16)}…/${localId} (${row.type}/${row.status})`);
		return this.toOwned(row);
	}

	async update(did: string, localId: string, patch: PostUpdate): Promise<OwnedPost> {
		const existing = await this.requireOwn(did, localId);
		const nextType: PostType = patch.type ?? existing.type;

		// Type switch clears the columns that don't belong to the new type.
		const keysToUnset: string[] = [];
		if (nextType === 'blog') keysToUnset.push('media_urls', 'display_mode');
		else keysToUnset.push('content_type', 'content');

		const merge: Partial<PostRow> = this.buildTypeFields(nextType, {
			content_type: patch.content_type ?? existing.content_type,
			content: patch.content ?? existing.content,
			media_urls: patch.media_urls ?? existing.media_urls,
			display_mode: patch.display_mode ?? existing.display_mode
		});
		merge.type = nextType;
		if (patch.title !== undefined) merge.title = patch.title.trim() || undefined;
		if (patch.description !== undefined) merge.description = patch.description.trim() || undefined;
		if (patch.visibility !== undefined) merge.visibility = patch.visibility;
		if (patch.status !== undefined) merge.status = patch.status;
		merge.updated_at = new Date();

		const onlyUnsetForNewType = patch.type && patch.type !== existing.type ? keysToUnset : [];
		let row = await this.posts.mergeWithUnset(did, localId, merge, onlyUnsetForNewType);

		const signed = await this.signPost(did, localId, row);
		if (signed) row = await this.posts.mergeByComposite(did, localId, { ...signed });

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'post_update',
			targetKind: 'post',
			targetId: localId,
			metadata: { type: row.type, status: row.status }
		});
		return this.toOwned(row);
	}

	async remove(did: string, localId: string): Promise<void> {
		await this.requireOwn(did, localId);
		// Only the post record is removed; its uploaded assets are preserved
		// (they live in the library) — mirrors syr's deletePost.
		await this.posts.deleteByComposite(did, localId);

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'post_delete',
			targetKind: 'post',
			targetId: localId
		});
	}

	async listOwn(
		did: string,
		options: { limit?: number; offset?: number; search?: string } = {}
	): Promise<{ posts: OwnedPost[]; total: number }> {
		const { data, total } = await this.posts.findAllByOwner(did, options);
		return { posts: data.map((r) => this.toOwned(r)), total };
	}

	async getOwn(did: string, localId: string): Promise<OwnedPost> {
		const row = await this.requireOwn(did, localId);
		return this.toOwned(row);
	}

	/**
	 * Presigned PUT for a post media asset. Key mirrors syr:
	 * `uploads/{did}/posts/{postLocalId}/public/{assetUlid}`. `post_id` may be a
	 * bare local id or `did/localId` — we take the trailing segment.
	 */
	async presignAsset(did: string, body: PostAssetPresign) {
		if (!POST_ASSET_MIME.has(body.mime_type)) {
			throw new HttpException('Post media must be JPEG, PNG, WebP, GIF, MP4, or WebM', 400);
		}
		// Post media caps at 50 MB, further clamped by the instance per-file limit.
		await this.instanceConfig.assertFileSize(body.size, MAX_POST_ASSET_BYTES);
		const postLocalId = body.post_id.includes('/')
			? body.post_id.slice(body.post_id.lastIndexOf('/') + 1)
			: body.post_id;
		// Confirm the target post exists and is the caller's before minting a key.
		await this.requireOwn(did, postLocalId);

		const assetId = ulid();
		const key = `uploads/${did}/posts/${postLocalId}/public/${assetId}`;
		const finalUrl = this.storage.buildUrl(key);
		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return {
			signed_url: signedUrl,
			final_url: finalUrl,
			upload_id: `${did}/${assetId}`,
			did,
			local_id: assetId,
			max_bytes: MAX_POST_ASSET_BYTES
		};
	}

	// ── helpers ──

	private async requireOwn(did: string, localId: string): Promise<PostRow> {
		const row = await this.posts.findByComposite(did, localId);
		if (!row) throw new HttpException('Post not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this post', 403);
		return row;
	}

	/** Build the type-specific column set with sensible fallbacks. */
	private buildTypeFields(
		type: PostType,
		fields: {
			content_type?: PostRow['content_type'];
			content?: string;
			media_urls?: string[];
			display_mode?: MediaDisplayMode;
		}
	): Partial<PostRow> {
		if (type === 'blog') {
			return {
				content_type: fields.content_type ?? 'markdown',
				content: fields.content ?? ''
			};
		}
		return {
			media_urls: (fields.media_urls ?? [])
				.map((u) => u.trim())
				.filter((u) => u.length > 0),
			display_mode: fields.display_mode ?? DEFAULT_DISPLAY_MODE
		};
	}

	/**
	 * Build + sign the canonical `post@v1` payload with the self-delegation
	 * key. Best-effort (matches profile signing): a failure logs and returns
	 * null so the post still persists unsigned rather than blocking the edit.
	 * Field-inclusion mirrors syr's `buildPostSignedPayloadV1` for signature
	 * parity (trim strings, omit empty; media always emits media_urls).
	 */
	private async signPost(
		did: string,
		localId: string,
		row: PostRow
	): Promise<{
		content_signature: string;
		signed_payload_json: string;
		signing_device_public_key: string;
	} | null> {
		try {
			const payload: Record<string, unknown> = {
				type: 'post@v1',
				did,
				post_id: localId,
				post_type: row.type
			};
			const title = row.title?.trim();
			const description = row.description?.trim();
			if (title) payload.title = title;
			if (description) payload.description = description;
			if (row.type === 'blog') {
				const content = row.content ?? '';
				if (content) payload.content = content;
				if (row.content_type) payload.content_type = row.content_type;
			} else {
				payload.media_urls = (row.media_urls ?? []).map((u) => u.trim()).filter(Boolean);
				if (row.display_mode) payload.display_mode = row.display_mode;
			}
			payload.visibility = row.visibility;
			payload.status = row.status;
			payload.created_at = new Date(row.created_at).toISOString();

			const signed = await this.platform.signContent(did, this.publicUrl(), payload);
			return {
				content_signature: signed.signature,
				signed_payload_json: JSON.stringify(payload),
				signing_device_public_key: signed.delegate_public_key
			};
		} catch (err) {
			this.logger.warn(
				`post signing skipped for ${did.slice(0, 16)}…/${localId}: ${(err as Error).message}`
			);
			return null;
		}
	}

	toOwned(row: PostRow): OwnedPost {
		const base: OwnedPost = {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			type: row.type,
			visibility: row.visibility,
			status: row.status,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
		if (row.title) base.title = row.title;
		if (row.description) base.description = row.description;
		if (row.type === 'blog') {
			if (row.content_type) base.content_type = row.content_type;
			if (row.content !== undefined) base.content = row.content;
		} else {
			base.media_urls = row.media_urls ?? [];
			if (row.display_mode) base.display_mode = row.display_mode;
		}
		if (row.content_signature) base.content_signature = row.content_signature;
		if (row.signed_payload_json) base.signed_payload_json = row.signed_payload_json;
		if (row.signing_device_public_key)
			base.signing_device_public_key = row.signing_device_public_key;
		return base;
	}
}
