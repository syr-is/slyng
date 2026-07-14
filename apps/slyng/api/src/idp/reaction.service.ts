import { HttpException, Injectable } from '@nestjs/common';
import {
	extractDid,
	extractLocalId,
	type ReactionCreate,
	type ReactionParentType,
	type ReactionsPage,
	type ReactionToggleResponse,
	type PublicReaction
} from '@slyng/types';
import { IdpAuditService } from './idp-audit.service';
import { ReactionRepository, type ReactionRow } from './idp-interaction.repository';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n)));

/**
 * Reactions on posts / comments for local accounts (P8). Composite-id, keyed by
 * reactor DID. POST is a toggle (re-reacting with the same kind+value removes
 * it) — port of syr's reaction.controller.ts. The by-target read aggregates
 * every reaction hosted here on a target so the reaction bar can group + count;
 * the per-author read is the federation surface. Reactions carry no signatures
 * (syr's public reaction shape has none), so nothing is signed here.
 */
@Injectable()
export class ReactionService {
	constructor(
		private readonly reactions: ReactionRepository,
		private readonly audit: IdpAuditService
	) {}

	/** Toggle: create the reaction, or remove it if the caller already has it. */
	async toggle(did: string, body: ReactionCreate): Promise<ReactionToggleResponse> {
		const target = {
			parent_type: body.parent_type,
			parent_did: body.parent_did,
			parent_id: body.parent_id,
			kind: body.kind,
			value: body.value
		};
		const existing = await this.reactions.findExisting(did, target);
		if (existing) {
			const localId = extractLocalId(existing.id);
			await this.reactions.deleteByComposite(did, localId);
			void this.audit.record({
				actorDid: did,
				action: 'reaction_remove',
				targetKind: 'reaction',
				targetId: localId,
				metadata: { parent_type: body.parent_type, parent_id: body.parent_id }
			});
			return { action: 'removed' };
		}

		const now = new Date();
		const row = await this.reactions.createWithCompositeId(did, {
			...target,
			image_url: body.image_url ?? null,
			created_at: now,
			updated_at: now
		});
		const localId = extractLocalId(row.id);
		void this.audit.record({
			actorDid: did,
			action: 'reaction_add',
			targetKind: 'reaction',
			targetId: localId,
			metadata: { parent_type: body.parent_type, parent_id: body.parent_id, value: body.value }
		});
		return { action: 'created', data: this.toPublic(row) };
	}

	async remove(did: string, localId: string): Promise<void> {
		const row = await this.reactions.findByComposite(did, localId);
		if (!row) throw new HttpException('Reaction not found', 404);
		if (extractDid(row.id) !== did) throw new HttpException('You do not own this reaction', 403);
		await this.reactions.deleteByComposite(did, localId);
		void this.audit.record({
			actorDid: did,
			action: 'reaction_remove',
			targetKind: 'reaction',
			targetId: localId
		});
	}

	// ── public reads (federation surface) ──

	/** Reactions authored by `did` (per-author, syr-exact). Optional target trio. */
	async listByAuthor(
		did: string,
		opts: {
			parentType?: ReactionParentType;
			parentDid?: string;
			parentId?: string;
			limit?: number;
			offset?: number;
		} = {}
	): Promise<ReactionsPage> {
		const limit = clamp(opts.limit ?? 50, 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.reactions.findPublicByAuthor(did, {
			parentType: opts.parentType,
			parentDid: opts.parentDid,
			parentId: opts.parentId,
			limit,
			offset
		});
		return {
			data: data.map((r) => this.toPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	/** Every reaction hosted here on one target (aggregation → reaction bar). */
	async listByTarget(
		parentType: ReactionParentType,
		parentDid: string,
		parentId: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<ReactionsPage> {
		const limit = clamp(opts.limit ?? 200, 1, 500);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.reactions.findByTarget(parentType, parentDid, parentId, {
			limit,
			offset
		});
		return {
			data: data.map((r) => this.toPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	private toPublic(row: ReactionRow): PublicReaction {
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			parent_type: row.parent_type,
			parent_did: row.parent_did,
			parent_id: row.parent_id,
			kind: row.kind,
			value: row.value,
			image_url: row.image_url ?? null,
			created_at: new Date(row.created_at).toISOString()
		};
	}
}
