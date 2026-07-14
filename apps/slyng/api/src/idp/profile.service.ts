import {
	forwardRef,
	HttpException,
	Inject,
	Injectable,
	Logger,
	Optional
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProfileAssetKind } from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { IdpStorageService } from './idp-storage.service';
import { IdpAuditService } from './idp-audit.service';
import { InstanceConfigService } from './instance-config.service';
import { PlatformService } from './platform.service';
import {
	IdpProfileRepository,
	LocalAccountRepository,
	type ProfileRow
} from './idp.repository';

const PROFILE_ASSET_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_PROFILE_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * Full profile hosting for local accounts (P4): avatar/banner presign +
 * profile edits with server-side content signing. Because slyng holds the
 * Aegis-encrypted seed (not the browser), the content signature is produced
 * by the account's **self-delegation** key — the same delegate key a login
 * session rides on — so a remote verifier can chain
 * signature → delegate key → root-signed delegation → DID. Password is not
 * required (the delegate key is unlocked with PLATFORM_DELEGATE_SECRET).
 */
@Injectable()
export class ProfileService {
	private readonly logger = new Logger(ProfileService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly storage: IdpStorageService,
		private readonly accounts: LocalAccountRepository,
		private readonly profiles: IdpProfileRepository,
		private readonly platform: PlatformService,
		private readonly audit: IdpAuditService,
		private readonly instanceConfig: InstanceConfigService,
		@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway
	) {}

	private publicUrl(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	/** Presigned PUT for an avatar/banner image. Stable key + read-time ?v= cache-bust. */
	async presignAsset(
		did: string,
		body: { kind: ProfileAssetKind; filename: string; mime_type: string; size: number; sha256?: string }
	) {
		if (!PROFILE_ASSET_MIME.has(body.mime_type)) {
			throw new HttpException('Profile image must be JPEG, PNG, WebP, or GIF', 400);
		}
		// Avatars/banners cap at 10 MB, further clamped by the instance per-file limit.
		await this.instanceConfig.assertFileSize(body.size, MAX_PROFILE_ASSET_BYTES);
		// Stable key — re-upload overwrites; getPublicProfile appends ?v=updated_at
		// so federated caches still see a fresh URL after each edit.
		const key = `uploads/${did}/me/profile/public/${body.kind}`;
		const finalUrl = this.storage.buildUrl(key);
		const signedUrl = await this.storage.presignPut(key, body.mime_type, body.sha256);
		return {
			signed_url: signedUrl,
			final_url: finalUrl,
			kind: body.kind,
			max_bytes: MAX_PROFILE_ASSET_BYTES
		};
	}

	/** Full profile edit — patch fields, re-sign the content, broadcast + audit. */
	async updateProfile(
		did: string,
		patch: {
			display_name?: string;
			bio?: string;
			avatar_url?: string | null;
			banner_url?: string | null;
		}
	) {
		const account = await this.accounts.findByDid(did);
		if (!account) {
			throw new HttpException('Profile editing is only available for local accounts', 403);
		}
		const profile = await this.profiles.findByAccountId(account.id);
		if (!profile) throw new HttpException('Profile not found', 404);

		const merged = {
			display_name: patch.display_name ?? profile.display_name,
			bio: patch.bio ?? profile.bio,
			avatar_url:
				patch.avatar_url === undefined ? profile.avatar_url : patch.avatar_url ?? undefined,
			banner_url:
				patch.banner_url === undefined ? profile.banner_url : patch.banner_url ?? undefined
		};

		const update: Record<string, unknown> = { updated_at: new Date() };
		if (patch.display_name !== undefined) update.display_name = patch.display_name;
		if (patch.bio !== undefined) update.bio = patch.bio;
		if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url ?? undefined;
		if (patch.banner_url !== undefined) update.banner_url = patch.banner_url ?? undefined;

		const signature = await this.signProfile(did, merged);
		if (signature) {
			update.content_signature = signature.content_signature;
			update.signed_payload_json = signature.signed_payload_json;
			update.signing_device_public_key = signature.signing_device_public_key;
		}

		const updated = await this.profiles.merge(profile.id, update);

		this.gateway?.broadcastProfileUpdate(did);
		void this.audit.record({
			actorDid: did,
			action: 'profile_update',
			targetKind: 'profile',
			targetId: did,
			metadata: {
				fields: Object.keys(patch).filter(
					(k) => (patch as Record<string, unknown>)[k] !== undefined
				)
			}
		});

		return this.toPublicShape(updated);
	}

	/** Record which asset changed (called after avatar/banner PATCH). */
	async recordAssetUpdate(did: string, kind: ProfileAssetKind): Promise<void> {
		void this.audit.record({
			actorDid: did,
			action: 'profile_asset_update',
			targetKind: 'profile',
			targetId: did,
			metadata: { kind }
		});
	}

	/**
	 * Build + sign the canonical `profile@v1` payload with the self-delegation
	 * key. Best-effort: a signing failure (no active self-delegation, invalid
	 * field) logs and returns null — the profile still updates unsigned rather
	 * than blocking the edit.
	 */
	private async signProfile(
		did: string,
		fields: {
			display_name?: string;
			bio?: string;
			avatar_url?: string;
			banner_url?: string;
		}
	): Promise<{
		content_signature: string;
		signed_payload_json: string;
		signing_device_public_key: string;
	} | null> {
		if (!fields.display_name) return null; // profile@v1 requires a display_name
		try {
			const payload: Record<string, unknown> = {
				type: 'profile@v1',
				did,
				display_name: fields.display_name
			};
			if (fields.bio) payload.bio = fields.bio;
			if (fields.avatar_url) payload.avatar_url = fields.avatar_url;
			if (fields.banner_url) payload.banner_url = fields.banner_url;

			const signed = await this.platform.signContent(did, this.publicUrl(), payload);
			return {
				content_signature: signed.signature,
				signed_payload_json: JSON.stringify(payload),
				signing_device_public_key: signed.delegate_public_key
			};
		} catch (err) {
			this.logger.warn(
				`profile signing skipped for ${did.slice(0, 16)}…: ${(err as Error).message}`
			);
			return null;
		}
	}

	private toPublicShape(p: ProfileRow) {
		return {
			display_name: p.display_name,
			bio: p.bio,
			avatar_url: p.avatar_url,
			banner_url: p.banner_url
		};
	}
}
