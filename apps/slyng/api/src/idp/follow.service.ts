import { HttpException, Injectable, Logger } from '@nestjs/common';
import { isValidSyrDid } from '@slyng/idp-crypto';
import {
	extractLocalId,
	type FollowCreate,
	type FollowVisibility,
	type OwnedFollow,
	type PublicFollow,
	type PublicFollowingResponse
} from '@slyng/types';
import { IdpAuditService } from './idp-audit.service';
import { IdpPublicService } from './idp-public.service';
import { FollowRepository, type FollowRow } from './idp-interaction.repository';

/**
 * Follows for local accounts (P8). Follow direction is follower → followed DID;
 * ownership (the follower) lives in the composite key, and the followed
 * identity's home instance is recorded in `followed_provider_url`. syr resolves
 * that provider from discovery registries; slyng has no registry yet (P9), so
 * the client — which already resolved the profile to render the follow button —
 * supplies `provider_url` (local DIDs default to this instance). The public
 * following list is the federation surface; its shape is syr's
 * publicFollowRowToJson.
 */
@Injectable()
export class FollowService {
	private readonly logger = new Logger(FollowService.name);

	constructor(
		private readonly follows: FollowRepository,
		private readonly publicService: IdpPublicService,
		private readonly audit: IdpAuditService
	) {}

	async follow(did: string, body: FollowCreate): Promise<OwnedFollow> {
		if (!isValidSyrDid(body.followed_did)) {
			throw new HttpException('Invalid followed DID', 400);
		}
		// Resolve the followed identity's home instance: explicit provider wins;
		// a local DID defaults to this instance; otherwise the client must supply
		// it (registry-based discovery arrives in P9).
		let provider = body.provider_url?.replace(/\/+$/, '') ?? null;
		if (!provider) {
			if (await this.publicService.isLocalDid(body.followed_did)) {
				provider = this.publicService.getPublicUrl();
			} else {
				throw new HttpException('provider_url is required to follow a remote identity', 400);
			}
		}

		const existing = await this.follows.findByFollowerAndFollowed(did, body.followed_did, provider);
		if (existing) return this.toOwned(existing); // idempotent

		const row = await this.follows.createWithCompositeId(did, {
			followed_did: body.followed_did,
			followed_provider_url: provider,
			is_public: false,
			created_at: new Date()
		});
		void this.audit.record({
			actorDid: did,
			action: 'follow_create',
			targetKind: 'follow',
			targetId: extractLocalId(row.id),
			metadata: { followed_did: body.followed_did }
		});
		this.logger.log(`${did.slice(0, 16)}… now follows ${body.followed_did.slice(0, 16)}…`);
		return this.toOwned(row);
	}

	async unfollow(
		did: string,
		params: { followed_did: string; provider_url?: string | null }
	): Promise<void> {
		const provider = params.provider_url?.replace(/\/+$/, '') ?? undefined;
		const existing = await this.follows.findByFollowerAndFollowed(did, params.followed_did, provider);
		if (!existing) return; // idempotent — already not following
		const localId = extractLocalId(existing.id);
		await this.follows.deleteByComposite(did, localId);
		void this.audit.record({
			actorDid: did,
			action: 'follow_delete',
			targetKind: 'follow',
			targetId: localId,
			metadata: { followed_did: params.followed_did }
		});
	}

	async setVisibility(did: string, body: FollowVisibility): Promise<OwnedFollow> {
		const provider = body.followed_provider_url?.replace(/\/+$/, '') ?? undefined;
		const existing = await this.follows.findByFollowerAndFollowed(did, body.followed_did, provider);
		if (!existing) throw new HttpException('Not following that identity', 404);
		const row = await this.follows.mergeByComposite(did, extractLocalId(existing.id), {
			is_public: body.is_public
		});
		void this.audit.record({
			actorDid: did,
			action: 'follow_update',
			targetKind: 'follow',
			targetId: extractLocalId(row.id),
			metadata: { is_public: body.is_public }
		});
		return this.toOwned(row);
	}

	async check(
		did: string,
		params: { followed_did: string; provider_url?: string | null }
	): Promise<{ following: boolean }> {
		const provider = params.provider_url?.replace(/\/+$/, '') ?? undefined;
		const existing = await this.follows.findByFollowerAndFollowed(did, params.followed_did, provider);
		return { following: existing !== null };
	}

	async listOwn(did: string): Promise<OwnedFollow[]> {
		const rows = await this.follows.findByFollower(did);
		return rows.map((r) => this.toOwned(r));
	}

	/** Public following list — the federation read (is_public only). */
	async listPublic(did: string): Promise<PublicFollowingResponse> {
		const rows = await this.follows.findPublicByFollower(did);
		return {
			data: rows.map((r) => this.toPublic(r)),
			pagination: { total: rows.length }
		};
	}

	private toOwned(row: FollowRow): OwnedFollow {
		return {
			followed_did: row.followed_did,
			followed_provider_url: row.followed_provider_url ?? null,
			is_public: !!row.is_public,
			created_at: new Date(row.created_at).toISOString()
		};
	}

	private toPublic(row: FollowRow): PublicFollow {
		return {
			followed_did: row.followed_did,
			followed_provider_url: row.followed_provider_url ?? null,
			created_at: new Date(row.created_at).toISOString()
		};
	}
}
