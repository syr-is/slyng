import {
	forwardRef,
	HttpException,
	Inject,
	Injectable,
	Logger,
	Optional
} from '@nestjs/common';
import { extractDid, extractLocalId, type OwnedStory, type UploadCreate } from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { InstanceConfigService } from './instance-config.service';
import {
	FolderRepository,
	LibraryUploadRepository,
	type LibraryUploadRow
} from './idp-content.repository';

const STORY_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const MAX_STORY_BYTES = 50 * 1024 * 1024;

/**
 * Owner-side story lifecycle for local accounts: presign → PUT → complete,
 * plus list + delete. Ported from syr's story upload flow
 * (upload.controller.ts::getStoryPutUrl and routes/api/stories/*). Stories
 * are `library_upload` rows flagged `is_story` + `is_public`; the public
 * 24h reel is served from IdpPublicService.
 *
 * Every mutation that changes a DID's active story set broadcasts
 * PROFILE_UPDATE (connected clients re-resolve immediately) and records an
 * IdP audit entry.
 */
@Injectable()
export class StoryService {
	private readonly logger = new Logger(StoryService.name);

	constructor(
		private readonly storage: IdpStorageService,
		private readonly uploads: LibraryUploadRepository,
		private readonly folders: FolderRepository,
		private readonly audit: IdpAuditService,
		private readonly instanceConfig: InstanceConfigService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	/** Presigned PUT for a new story slide. Key: uploads/{did}/stories/{utcDay}/public/{ulid}. */
	async presign(did: string, body: UploadCreate) {
		if (!STORY_ALLOWED_MIME.has(body.mime_type)) {
			throw new HttpException('Story media must be JPEG, PNG, WebP, or MP4', 400);
		}
		// Stories cap at 50 MB, further clamped by the instance per-file limit.
		await this.instanceConfig.assertFileSize(body.size, MAX_STORY_BYTES);
		const now = new Date();
		const utcDay = now.toISOString().slice(0, 10);

		// Logical folder nesting mirrors syr so P7's library sees the hierarchy.
		const stories = await this.folders.findOrCreate(did, 'stories', null);
		const dayFolder = await this.folders.findOrCreate(did, utcDay, stories.id);
		const publicFolder = await this.folders.findOrCreate(did, 'public', dayFolder.id);

		let row = await this.uploads.createWithCompositeId(did, {
			filename: body.filename,
			mime_type: body.mime_type,
			size: body.size,
			sha256: body.sha256,
			metadata: body.metadata,
			folder_id: publicFolder.id,
			status: 'pending',
			is_public: true,
			is_story: true,
			created_at: now,
			updated_at: now
		});

		const localId = extractLocalId(row.id);
		const key = `uploads/${did}/stories/${utcDay}/public/${localId}`;
		const finalUrl = this.storage.buildUrl(key);

		row = await this.uploads.mergeByComposite(did, localId, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);

		return {
			signed_url: signedUrl,
			final_url: finalUrl,
			upload_id: `${did}/${localId}`,
			did,
			local_id: localId,
			max_bytes: MAX_STORY_BYTES
		};
	}

	/** Verify the object landed in S3, then flip the story to completed + published. */
	async complete(
		did: string,
		localId: string,
		data: { sha256?: string; width?: number; height?: number; duration_seconds?: number }
	): Promise<OwnedStory> {
		const row = await this.requireOwnStory(did, localId);
		if (row.status === 'completed') return this.toOwned(row);
		if (!row.key) throw new HttpException('Story has no storage key', 409);

		const head = await this.storage.headObject(row.key);
		if (!head) {
			throw new HttpException('Uploaded file not found yet — retry shortly', 409);
		}
		if (head.ContentLength !== row.size) {
			throw new HttpException(
				`Size mismatch: expected ${row.size}, got ${head.ContentLength}`,
				400
			);
		}

		const metadata: Record<string, unknown> = { ...(row.metadata ?? {}) };
		if (data.width && Number.isFinite(data.width)) metadata.width = Math.floor(data.width);
		if (data.height && Number.isFinite(data.height)) metadata.height = Math.floor(data.height);
		if (data.duration_seconds && Number.isFinite(data.duration_seconds)) {
			metadata.duration_seconds = Math.floor(data.duration_seconds);
		}

		const now = new Date();
		const updated = await this.uploads.mergeByComposite(did, localId, {
			status: 'completed',
			published_at: row.published_at ? new Date(row.published_at) : now,
			metadata,
			...(data.sha256 ? { sha256: data.sha256 } : {}),
			updated_at: now
		});

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'story_publish',
			targetKind: 'story',
			targetId: localId,
			metadata: { mime_type: updated.mime_type }
		});
		this.logger.log(`Story published ${did.slice(0, 16)}…/${localId}`);
		return this.toOwned(updated);
	}

	/** Every story the owner has (any status), newest first. */
	async listOwn(did: string): Promise<OwnedStory[]> {
		const rows = await this.uploads.findAllStoriesByDid(did);
		return rows.map((r) => this.toOwned(r));
	}

	async remove(did: string, localId: string): Promise<void> {
		const row = await this.requireOwnStory(did, localId);
		await this.uploads.deleteByComposite(did, localId);
		if (row.key) await this.storage.deleteObject(row.key);

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'story_delete',
			targetKind: 'story',
			targetId: localId
		});
	}

	private async requireOwnStory(did: string, localId: string): Promise<LibraryUploadRow> {
		const row = await this.uploads.findByComposite(did, localId);
		if (!row) throw new HttpException('Story not found', 404);
		// Composite key embeds the owner DID — a mismatch means it isn't theirs.
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this story', 403);
		if (!row.is_story) throw new HttpException('Upload is not a story', 400);
		return row;
	}

	private toOwned(row: LibraryUploadRow): OwnedStory {
		const meta = (row.metadata ?? {}) as Record<string, unknown>;
		const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			filename: row.filename,
			mime_type: row.mime_type,
			size: row.size,
			url: row.url ?? null,
			status: row.status,
			is_public: row.is_public,
			is_story: row.is_story,
			published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString(),
			width: num(meta.width),
			height: num(meta.height),
			duration_seconds: num(meta.duration_seconds)
		};
	}
}
