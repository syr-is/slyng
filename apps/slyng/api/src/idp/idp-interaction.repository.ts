import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type {
	CommentStatus,
	CommentVisibility,
	IdpReactionKind,
	ReactionParentType
} from '@slyng/types';
import { CompositeIdRepository } from '../db/composite.repository';
import { DbService } from '../db/db.service';

/**
 * Comments, reactions, and follows for local accounts (P8). All three are
 * owned/portable content keyed on a composite RecordId
 * (`table:{ created_by: <did>, id: <ulid> }`) — ownership lives in the key, so
 * there is no `author_id`/`follower_user_id` column; queries filter the indexed
 * `id.created_by` subfield. Row shapes mirror syr's `comment`/`reaction`/
 * `user_follow` (apps/syr/app/src/lib/repositories/*), minus the columns that
 * belong to later phases (reaction signatures, follow `source_registry`).
 */

export interface CommentRow extends Record<string, unknown> {
	id: RecordId;
	post_did: string;
	post_id: string;
	ancestor_chain: string[];
	content: string;
	visibility: CommentVisibility;
	status: CommentStatus;
	content_signature?: string;
	signed_payload_json?: string;
	signing_device_public_key?: string;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class CommentRepository extends CompositeIdRepository<CommentRow> {
	protected tableName = 'comment';
	constructor(db: DbService) {
		super(db);
	}

	/** The caller's own comments (any status/visibility), newest first. */
	async findOwnPage(
		did: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ data: CommentRow[]; total: number }> {
		const [data, total] = await Promise.all([
			this.findByOwnerDid(did, {
				sort: { field: 'created_at', order: 'desc' },
				limit: options.limit,
				offset: options.offset
			}),
			this.countByOwnerDid(did)
		]);
		return { data, total };
	}

	/**
	 * Comments *authored by* `did` — the federation read (per-author, syr-exact).
	 * Only public + completed; optionally scoped to one post. Oldest → newest,
	 * matching syr's `findPublicByDid`.
	 */
	async findPublicByAuthor(
		did: string,
		options: { postDid?: string; postId?: string; limit?: number; offset?: number } = {}
	): Promise<{ data: CommentRow[]; total: number }> {
		const { where, vars } = this.publicWhere({
			author: did,
			postDid: options.postDid,
			postId: options.postId
		});
		return this.page(where, vars, 'created_at ASC', options.limit, options.offset);
	}

	/**
	 * Every public + completed comment hosted on this instance for one post,
	 * regardless of author — the by-target aggregation that renders a thread.
	 * Oldest → newest so `ancestor_chain` nesting reads top-down.
	 */
	async findByTarget(
		postDid: string,
		postId: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ data: CommentRow[]; total: number }> {
		const { where, vars } = this.publicWhere({ postDid, postId });
		return this.page(where, vars, 'created_at ASC', options.limit, options.offset);
	}

	private publicWhere(opts: { author?: string; postDid?: string; postId?: string }): {
		where: string;
		vars: Record<string, unknown>;
	} {
		const clauses = ["visibility = 'public'", "status = 'completed'"];
		const vars: Record<string, unknown> = {};
		if (opts.author !== undefined) {
			clauses.unshift('id.created_by = $author');
			vars.author = opts.author;
		}
		if (opts.postDid !== undefined) {
			clauses.push('post_did = $postDid');
			vars.postDid = opts.postDid;
		}
		if (opts.postId !== undefined) {
			clauses.push('post_id = $postId');
			vars.postId = opts.postId;
		}
		return { where: clauses.join(' AND '), vars };
	}

	private async page(
		where: string,
		vars: Record<string, unknown>,
		order: string,
		limit?: number,
		offset?: number
	): Promise<{ data: CommentRow[]; total: number }> {
		const lim = limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(limit))}` : '';
		const start = offset !== undefined ? `START ${Math.max(0, Math.floor(offset))}` : '';
		const [rows, count] = await Promise.all([
			this.db.query<[CommentRow[]]>(
				`SELECT * FROM ${this.tableName} WHERE ${where} ORDER BY ${order} ${lim} ${start}`,
				vars
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM ${this.tableName} WHERE ${where} GROUP ALL`,
				vars
			)
		]);
		return { data: rows[0] ?? [], total: count[0]?.[0]?.total ?? 0 };
	}
}

export interface ReactionRow extends Record<string, unknown> {
	id: RecordId;
	parent_type: ReactionParentType;
	parent_did: string;
	parent_id: string;
	kind: IdpReactionKind;
	value: string;
	image_url?: string | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class ReactionRepository extends CompositeIdRepository<ReactionRow> {
	protected tableName = 'reaction';
	constructor(db: DbService) {
		super(db);
	}

	/** The caller's existing reaction on a target (the toggle lookup). */
	async findExisting(
		did: string,
		target: {
			parent_type: ReactionParentType;
			parent_did: string;
			parent_id: string;
			kind: IdpReactionKind;
			value: string;
		}
	): Promise<ReactionRow | null> {
		const result = await this.db.query<[ReactionRow[]]>(
			`SELECT * FROM reaction
			 WHERE id.created_by = $did AND parent_type = $pt AND parent_did = $pd
			   AND parent_id = $pid AND kind = $kind AND value = $value
			 LIMIT 1`,
			{
				did,
				pt: target.parent_type,
				pd: target.parent_did,
				pid: target.parent_id,
				kind: target.kind,
				value: target.value
			}
		);
		return result[0]?.[0] ?? null;
	}

	/** Reactions *authored by* `did` — the federation read (per-author, syr-exact). */
	async findPublicByAuthor(
		did: string,
		options: {
			parentType?: ReactionParentType;
			parentDid?: string;
			parentId?: string;
			limit?: number;
			offset?: number;
		} = {}
	): Promise<{ data: ReactionRow[]; total: number }> {
		const clauses = ['id.created_by = $did'];
		const vars: Record<string, unknown> = { did };
		if (options.parentType !== undefined) {
			clauses.push('parent_type = $pt', 'parent_did = $pd', 'parent_id = $pid');
			vars.pt = options.parentType;
			vars.pd = options.parentDid;
			vars.pid = options.parentId;
		}
		return this.page(clauses.join(' AND '), vars, options.limit, options.offset);
	}

	/**
	 * Every reaction hosted on this instance for one target (post or comment),
	 * regardless of reactor — the by-target aggregation for the reaction bar.
	 */
	async findByTarget(
		parentType: ReactionParentType,
		parentDid: string,
		parentId: string,
		options: { limit?: number; offset?: number } = {}
	): Promise<{ data: ReactionRow[]; total: number }> {
		return this.page(
			'parent_type = $pt AND parent_did = $pd AND parent_id = $pid',
			{ pt: parentType, pd: parentDid, pid: parentId },
			options.limit,
			options.offset
		);
	}

	private async page(
		where: string,
		vars: Record<string, unknown>,
		limit?: number,
		offset?: number
	): Promise<{ data: ReactionRow[]; total: number }> {
		const lim = limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(limit))}` : '';
		const start = offset !== undefined ? `START ${Math.max(0, Math.floor(offset))}` : '';
		const [rows, count] = await Promise.all([
			this.db.query<[ReactionRow[]]>(
				`SELECT * FROM reaction WHERE ${where} ORDER BY created_at DESC ${lim} ${start}`,
				vars
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM reaction WHERE ${where} GROUP ALL`,
				vars
			)
		]);
		return { data: rows[0] ?? [], total: count[0]?.[0]?.total ?? 0 };
	}
}

export interface FollowRow extends Record<string, unknown> {
	id: RecordId;
	followed_did: string;
	followed_provider_url?: string | null;
	is_public: boolean;
	created_at: Date;
}

@Injectable()
export class FollowRepository extends CompositeIdRepository<FollowRow> {
	protected tableName = 'user_follow';
	constructor(db: DbService) {
		super(db);
	}

	/** Everyone the follower follows, newest first. */
	async findByFollower(did: string): Promise<FollowRow[]> {
		return this.findByOwnerDid(did, { sort: { field: 'created_at', order: 'desc' } });
	}

	/**
	 * The follower's existing follow of `followedDid`. When `providerUrl` is
	 * given it must match too (syr allows following the same DID once per
	 * provider); otherwise the first follow of that DID is returned.
	 */
	async findByFollowerAndFollowed(
		followerDid: string,
		followedDid: string,
		providerUrl?: string | null
	): Promise<FollowRow | null> {
		const clauses = ['id.created_by = $did', 'followed_did = $fd'];
		const vars: Record<string, unknown> = { did: followerDid, fd: followedDid };
		if (providerUrl !== undefined && providerUrl !== null) {
			clauses.push('followed_provider_url = $provider');
			vars.provider = providerUrl;
		}
		const result = await this.db.query<[FollowRow[]]>(
			`SELECT * FROM user_follow WHERE ${clauses.join(' AND ')} LIMIT 1`,
			vars
		);
		return result[0]?.[0] ?? null;
	}

	/** Public follows for a DID — the federation read (is_public only). */
	async findPublicByFollower(did: string): Promise<FollowRow[]> {
		const result = await this.db.query<[FollowRow[]]>(
			`SELECT * FROM user_follow
			 WHERE id.created_by = $did AND is_public = true
			 ORDER BY created_at DESC`,
			{ did }
		);
		return result[0] ?? [];
	}
}
