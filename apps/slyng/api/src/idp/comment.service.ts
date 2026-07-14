import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	extractDid,
	extractLocalId,
	type CommentCreate,
	type CommentsPage,
	type CommentUpdate,
	type OwnedComment,
	type PublicComment
} from '@slyng/types';
import { IdpAuditService } from './idp-audit.service';
import { PlatformService } from './platform.service';
import { CommentRepository, type CommentRow } from './idp-interaction.repository';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n)));

/**
 * Comments authored by local accounts (P8). Composite-id CRUD with server-side
 * `comment@v1` signing via the account's self-delegation — the same
 * signing-as-a-service path posts use. A comment always lives on its author's
 * instance; the by-target reads (`listByTarget`) aggregate every comment hosted
 * here for a post so a thread renders. Public reads are the federation surface.
 * Paths + payload mirror syr's comment.controller.ts.
 */
@Injectable()
export class CommentService {
	private readonly logger = new Logger(CommentService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly comments: CommentRepository,
		private readonly platform: PlatformService,
		private readonly audit: IdpAuditService
	) {}

	private publicUrl(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	// ── owner CRUD ──

	async create(did: string, body: CommentCreate): Promise<OwnedComment> {
		const now = new Date();
		const data: Partial<CommentRow> = {
			post_did: body.post_did,
			post_id: body.post_id,
			ancestor_chain: body.ancestor_chain ?? [],
			content: body.content,
			visibility: body.visibility,
			status: body.status,
			created_at: now,
			updated_at: now
		};

		let row = body.comment_local_id
			? await this.comments.createWithExplicitId(did, body.comment_local_id, data)
			: await this.comments.createWithCompositeId(did, data);

		const localId = extractLocalId(row.id);
		const signed = await this.signComment(did, localId, row);
		if (signed) row = await this.comments.mergeByComposite(did, localId, { ...signed });

		void this.audit.record({
			actorDid: did,
			action: 'comment_create',
			targetKind: 'comment',
			targetId: localId,
			metadata: { post_did: row.post_did, post_id: row.post_id }
		});
		this.logger.log(
			`Comment ${did.slice(0, 16)}…/${localId} on ${row.post_did.slice(0, 16)}…/${row.post_id}`
		);
		return this.toOwned(row);
	}

	async update(did: string, localId: string, patch: CommentUpdate): Promise<OwnedComment> {
		await this.requireOwn(did, localId);
		const merge: Partial<CommentRow> = { updated_at: new Date() };
		if (patch.content !== undefined) merge.content = patch.content;
		if (patch.visibility !== undefined) merge.visibility = patch.visibility;
		if (patch.status !== undefined) merge.status = patch.status;

		let row = await this.comments.mergeByComposite(did, localId, merge);
		const signed = await this.signComment(did, localId, row);
		if (signed) row = await this.comments.mergeByComposite(did, localId, { ...signed });

		void this.audit.record({
			actorDid: did,
			action: 'comment_update',
			targetKind: 'comment',
			targetId: localId
		});
		return this.toOwned(row);
	}

	async remove(did: string, localId: string): Promise<void> {
		await this.requireOwn(did, localId);
		// Hard delete, matching syr's comment contract (there is no
		// federated "view removed" concept, so nothing to mask).
		await this.comments.deleteByComposite(did, localId);
		void this.audit.record({
			actorDid: did,
			action: 'comment_delete',
			targetKind: 'comment',
			targetId: localId
		});
	}

	async listOwn(
		did: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ comments: OwnedComment[]; total: number }> {
		const { data, total } = await this.comments.findOwnPage(did, options);
		return { comments: data.map((r) => this.toOwned(r)), total };
	}

	async getOwn(did: string, localId: string): Promise<OwnedComment> {
		return this.toOwned(await this.requireOwn(did, localId));
	}

	// ── public reads (federation surface) ──

	/** Comments authored by `did` (per-author, syr-exact), optionally one post. */
	async listByAuthor(
		did: string,
		opts: { postDid?: string; postId?: string; limit?: number; offset?: number } = {}
	): Promise<CommentsPage> {
		const limit = clamp(opts.limit ?? 50, 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.comments.findPublicByAuthor(did, {
			postDid: opts.postDid,
			postId: opts.postId,
			limit,
			offset
		});
		return {
			data: data.map((r) => this.toPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	/** Every comment hosted here for one post (aggregation → thread render). */
	async listByTarget(
		postDid: string,
		postId: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<CommentsPage> {
		const limit = clamp(opts.limit ?? 100, 1, 200);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.comments.findByTarget(postDid, postId, { limit, offset });
		return {
			data: data.map((r) => this.toPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	// ── helpers ──

	private async requireOwn(did: string, localId: string): Promise<CommentRow> {
		const row = await this.comments.findByComposite(did, localId);
		if (!row) throw new HttpException('Comment not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this comment', 403);
		return row;
	}

	/**
	 * Sign the canonical `comment@v1` payload with the self-delegation key.
	 * Best-effort (matches post/profile signing): a failure logs and returns
	 * null so the comment still persists unsigned. Field order mirrors syr's
	 * comment-signed-payload.ts for signature parity.
	 */
	private async signComment(
		did: string,
		localId: string,
		row: CommentRow
	): Promise<{
		content_signature: string;
		signed_payload_json: string;
		signing_device_public_key: string;
	} | null> {
		try {
			const payload: Record<string, unknown> = {
				type: 'comment@v1',
				did,
				comment_id: localId,
				post_did: row.post_did,
				post_id: row.post_id,
				ancestor_chain: row.ancestor_chain ?? [],
				content: row.content,
				visibility: row.visibility,
				status: row.status,
				created_at: new Date(row.created_at).toISOString()
			};
			const signed = await this.platform.signContent(did, this.publicUrl(), payload);
			return {
				content_signature: signed.signature,
				signed_payload_json: JSON.stringify(payload),
				signing_device_public_key: signed.delegate_public_key
			};
		} catch (err) {
			this.logger.warn(
				`comment signing skipped for ${did.slice(0, 16)}…/${localId}: ${(err as Error).message}`
			);
			return null;
		}
	}

	toOwned(row: CommentRow): OwnedComment {
		const base: OwnedComment = {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			post_did: row.post_did,
			post_id: row.post_id,
			ancestor_chain: row.ancestor_chain ?? [],
			content: row.content,
			visibility: row.visibility,
			status: row.status,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
		if (row.content_signature) base.content_signature = row.content_signature;
		if (row.signed_payload_json) base.signed_payload_json = row.signed_payload_json;
		if (row.signing_device_public_key)
			base.signing_device_public_key = row.signing_device_public_key;
		return base;
	}

	private toPublic(row: CommentRow): PublicComment {
		return this.toOwned(row);
	}
}
