import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type {
	MediaDisplayMode,
	PostContentType,
	PostStatus,
	PostType,
	PostVisibility
} from '@slyng/types';
import { CompositeIdRepository } from '../db/composite.repository';
import { DbService } from '../db/db.service';

/**
 * Owned blog/media posts, keyed on a composite RecordId
 * (`post:{ created_by: <did>, id: <ulid> }`). Ownership lives in the key, so —
 * unlike syr — there is no separate `author_id`; every query filters the
 * indexed `id.created_by` subfield. Row shape mirrors syr's `Post`
 * (apps/syr/app/src/lib/repositories/post.repository.ts).
 */
export interface PostRow extends Record<string, unknown> {
	id: RecordId;
	type: PostType;
	content_type?: PostContentType;
	title?: string;
	description?: string;
	content?: string;
	media_urls?: string[];
	display_mode?: MediaDisplayMode;
	visibility: PostVisibility;
	status: PostStatus;
	content_signature?: string;
	signed_payload_json?: string;
	signing_device_public_key?: string;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class PostRepository extends CompositeIdRepository<PostRow> {
	protected tableName = 'post';
	constructor(db: DbService) {
		super(db);
	}

	/** Every post the owner has (any status/visibility), newest first. */
	async findAllByOwner(
		did: string,
		options: { limit?: number; offset?: number; search?: string } = {}
	): Promise<{ data: PostRow[]; total: number }> {
		const [data, total] = await Promise.all([
			this.findByOwnerDid(did, {
				sort: { field: 'created_at', order: 'desc' },
				limit: options.limit,
				offset: options.offset
			}),
			this.countByOwnerDid(did)
		]);
		// Cheap in-memory search (title/description) — the owner's own post set
		// is small; a DB CONTAINS filter arrives with the P7 library work.
		if (options.search?.trim()) {
			const q = options.search.trim().toLowerCase();
			const filtered = data.filter(
				(p) =>
					(p.title ?? '').toLowerCase().includes(q) ||
					(p.description ?? '').toLowerCase().includes(q)
			);
			return { data: filtered, total: filtered.length };
		}
		return { data, total };
	}

	/**
	 * Public posts for a DID — the federation read surface. Only
	 * `visibility = 'public' AND status = 'completed'` are ever exposed; drafts,
	 * unlisted, and private posts stay hidden. Port of syr's `findPublicByDid`.
	 */
	async findPublicByDid(
		did: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ data: PostRow[]; total: number }> {
		const filters = { visibility: 'public', status: 'completed' };
		const [data, total] = await Promise.all([
			this.findByOwnerDid(did, {
				filters,
				sort: { field: 'created_at', order: 'desc' },
				limit: options.limit,
				offset: options.offset
			}),
			this.countByOwnerDid(did, filters)
		]);
		return { data, total };
	}

	/**
	 * Change-detection digest for the public hash. Port of syr's `digestByDid`,
	 * with syr's `status = 'published'` typo corrected to `'completed'` (the
	 * only two statuses are draft/completed) so the post digest actually flips
	 * when a public post is published.
	 */
	async digestByDid(did: string): Promise<{ count: number; latestUpdatedAt: string | null }> {
		const result = await this.db.query<[{ cnt: number; latest: string | Date | null }[]]>(
			`SELECT count() AS cnt, math::max(updated_at) AS latest
			 FROM post
			 WHERE id.created_by = $did AND status = 'completed'
			 GROUP ALL`,
			{ did }
		);
		const row = result[0]?.[0];
		if (!row) return { count: 0, latestUpdatedAt: null };
		return {
			count: row.cnt ?? 0,
			latestUpdatedAt: row.latest ? new Date(row.latest).toISOString() : null
		};
	}

	/**
	 * Merge + UNSET in one shot — needed for blog↔media type switches, where
	 * `merge` alone can't clear the now-irrelevant columns. Two statements
	 * against the same owner-held record (no cross-user concurrency to guard).
	 */
	async mergeWithUnset(
		did: string,
		localId: string,
		data: Partial<PostRow>,
		keysToUnset: string[]
	): Promise<PostRow> {
		const safeKeys = keysToUnset.filter((k) => /^\w+$/.test(k));
		if (safeKeys.length) {
			await this.db.query(`UPDATE $id UNSET ${safeKeys.join(', ')};`, {
				id: this.compositeId(did, localId)
			});
		}
		return this.mergeByComposite(did, localId, data);
	}
}
