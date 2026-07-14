import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { AegisBundle } from '@syren/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Repositories for the local identity-provider tables. Row shapes mirror
 * syr's (apps/syr/app/src/lib/repositories/identity.repository.ts) with one
 * rename: syr's `user_id` link is `account_id` here, because syren's chat
 * `user` table is a separate DID-keyed concept.
 */

export interface LocalAccountRow extends Record<string, unknown> {
	id: RecordId;
	username: string;
	password_hash: string;
	role: 'USER' | 'ADMIN';
	did?: string;
	username_last_updated?: Date;
	created_at: Date;
	updated_at: Date;
}

export interface IdentityRow extends Record<string, unknown> {
	id: RecordId;
	did: string;
	public_key: string;
	account_id: RecordId;
	aegis_salt?: string;
	aegis_nonce?: string;
	aegis_ct?: string;
	aegis_tag?: string;
	aegis_kdf_mem?: number;
	aegis_kdf_it?: number;
	aegis_kdf_par?: number;
	created_at: Date;
}

export interface DelegatedKeyRow extends Record<string, unknown> {
	id: RecordId;
	did: string;
	public_key: string;
	scope: string;
	platform_origin?: string;
	platform_name?: string;
	aegis_delegate?: AegisBundle;
	signature: string;
	canonical_delegation: string;
	created_at: Date;
	expires_at?: Date;
	revoked_at?: Date;
}

export interface ProfileRow extends Record<string, unknown> {
	id: RecordId;
	account_id: RecordId;
	display_name?: string;
	bio?: string;
	avatar_url?: string;
	banner_url?: string;
	identity_host_url?: string;
	content_signature?: string;
	signed_payload_json?: string;
	signing_device_public_key?: string;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class LocalAccountRepository extends BaseRepository<LocalAccountRow> {
	protected tableName = 'local_account';
	constructor(db: DbService) {
		super(db);
	}

	async findByUsername(username: string): Promise<LocalAccountRow | null> {
		return this.findOne({ username });
	}

	async findByDid(did: string): Promise<LocalAccountRow | null> {
		return this.findOne({ did });
	}

	async usernameExists(username: string): Promise<boolean> {
		return (await this.findByUsername(username)) !== null;
	}
}

@Injectable()
export class IdentityRepository extends BaseRepository<IdentityRow> {
	protected tableName = 'identity';
	constructor(db: DbService) {
		super(db);
	}

	async findByDid(did: string): Promise<IdentityRow | null> {
		return this.findOne({ did });
	}

	async findByAccountId(accountId: RecordId | string): Promise<IdentityRow | null> {
		return this.findOne({ account_id: this.toRecordId(accountId) });
	}

	async deleteByDid(did: string): Promise<void> {
		await this.deleteWhere({ did });
	}

	/**
	 * Create an identity with Aegis (password-protected encrypted seed).
	 * Stores the Aegis bundle fields; no raw private key. Port of syr's
	 * identityRepository.createIdentityAegis.
	 */
	async createIdentityAegis(params: {
		did: string;
		publicKey: string;
		aegisBundle: AegisBundle;
		accountId: RecordId;
		now: Date;
	}): Promise<IdentityRow> {
		const { did, publicKey, aegisBundle, accountId, now } = params;
		return this.create({
			did,
			public_key: publicKey,
			aegis_salt: aegisBundle.salt,
			aegis_nonce: aegisBundle.nonce,
			aegis_ct: aegisBundle.ct,
			aegis_tag: aegisBundle.tag,
			aegis_kdf_mem: aegisBundle.kdf.mem,
			aegis_kdf_it: aegisBundle.kdf.it,
			aegis_kdf_par: aegisBundle.kdf.par,
			account_id: accountId,
			created_at: now
		});
	}

	/**
	 * Create a self-custody identity — no Aegis columns. The root seed lives
	 * on the user's device; the server never holds it. This is exactly what
	 * distinguishes a self-custody identity (independent login / device
	 * import) from a password account. Port of syr's createIdentityExternal.
	 */
	async createIdentityExternal(params: {
		did: string;
		publicKey: string;
		accountId: RecordId;
		now: Date;
	}): Promise<IdentityRow> {
		return this.create({
			did: params.did,
			public_key: params.publicKey,
			account_id: params.accountId,
			created_at: params.now
		});
	}
}

@Injectable()
export class DelegatedKeyRepository extends BaseRepository<DelegatedKeyRow> {
	protected tableName = 'delegated_key';
	constructor(db: DbService) {
		super(db);
	}

	async findByPublicKey(publicKey: string): Promise<DelegatedKeyRow | null> {
		return this.findOne({ public_key: publicKey });
	}

	/** Find the active platform delegation for a DID + platform origin combo. */
	async findByDidAndPlatformOrigin(
		did: string,
		platformOrigin: string
	): Promise<DelegatedKeyRow | null> {
		const result = await this.db.query<[DelegatedKeyRow[]]>(
			`SELECT * FROM delegated_key
			 WHERE did = $did
			   AND scope = 'platform'
			   AND platform_origin = $platformOrigin
			   AND revoked_at IS NONE
			   AND (expires_at IS NONE OR expires_at > time::now())
			 ORDER BY created_at DESC
			 LIMIT 1`,
			{ did, platformOrigin }
		);
		return result[0]?.[0] ?? null;
	}

	/** All platform-scoped delegations for a DID (including revoked). */
	async findPlatformDelegationsByDid(did: string): Promise<DelegatedKeyRow[]> {
		const result = await this.db.query<[DelegatedKeyRow[]]>(
			`SELECT * FROM delegated_key
			 WHERE did = $did AND scope = 'platform'
			 ORDER BY created_at DESC`,
			{ did }
		);
		return result[0] ?? [];
	}

	/** Create a platform-scoped delegated key with encrypted private key. */
	async createPlatformDelegatedKey(params: {
		did: string;
		publicKey: string;
		platformOrigin: string;
		platformName: string;
		aegisDelegate: AegisBundle;
		createdAt: Date;
		expiresAt?: Date;
		signature: string;
		canonicalDelegation: string;
	}): Promise<DelegatedKeyRow> {
		return this.create({
			did: params.did,
			public_key: params.publicKey,
			scope: 'platform',
			platform_origin: params.platformOrigin,
			platform_name: params.platformName,
			aegis_delegate: params.aegisDelegate,
			created_at: params.createdAt,
			...(params.expiresAt ? { expires_at: params.expiresAt } : {}),
			signature: params.signature,
			canonical_delegation: params.canonicalDelegation
		});
	}

	async revoke(id: RecordId | string): Promise<DelegatedKeyRow> {
		return this.merge(id, { revoked_at: new Date() });
	}

	async deleteByDid(did: string): Promise<void> {
		await this.deleteWhere({ did });
	}
}

@Injectable()
export class IdpProfileRepository extends BaseRepository<ProfileRow> {
	protected tableName = 'profile';
	constructor(db: DbService) {
		super(db);
	}

	async findByAccountId(accountId: RecordId | string): Promise<ProfileRow | null> {
		return this.findOne({ account_id: this.toRecordId(accountId) });
	}

	async deleteByAccountId(accountId: RecordId | string): Promise<void> {
		await this.deleteWhere({ account_id: this.toRecordId(accountId) });
	}

	/** Merge fields into the profile row for an account (drops `undefined`). */
	async mergeByAccountId(
		accountId: RecordId | string,
		data: Partial<ProfileRow>
	): Promise<void> {
		const existing = await this.findByAccountId(accountId);
		if (!existing) return;
		const clean = Object.fromEntries(
			Object.entries(data).filter(([, v]) => v !== undefined)
		) as Partial<ProfileRow>;
		await this.merge(existing.id, clean);
	}
}
