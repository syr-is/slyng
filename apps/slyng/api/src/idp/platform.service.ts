import { Injectable, Logger } from '@nestjs/common';
import {
	generateDeviceKeypair,
	sign,
	canonicalize,
	encodeMultibase,
	ED25519_MULTICODEC_PREFIX
} from '@slyng/idp-crypto';
import type { AegisBundle } from '@slyng/types';
import { IdpCryptoService } from './idp-crypto.service';
import {
	DelegatedKeyRepository,
	IdentityRepository,
	type IdentityRow
} from './idp.repository';

/**
 * Platform delegation: creating delegate keys, signing-as-a-service,
 * challenge-based re-login, and revocation. Near-verbatim port of syr's
 * controllers/platform-delegation.controller.ts on slyng repositories.
 *
 * A local user's own login session rides on a "self-delegation" — a
 * delegation whose platform_origin is this instance's PUBLIC_URL — so
 * local and federated identities share one data model end to end.
 */
@Injectable()
export class PlatformService {
	private readonly logger = new Logger(PlatformService.name);

	constructor(
		private readonly crypto: IdpCryptoService,
		private readonly identities: IdentityRepository,
		private readonly delegatedKeys: DelegatedKeyRepository
	) {}

	/**
	 * Create a platform delegation for a DID. Generates a new Ed25519
	 * delegate keypair, signs the delegation statement with the root key
	 * (via rootSignFn), encrypts the delegate private key, and stores it.
	 * Reuses an existing active delegation for the same origin.
	 */
	async createPlatformDelegation(params: {
		did: string;
		platformOrigin: string;
		platformName: string;
		rootSignFn: (delegationStatement: string) => Promise<Uint8Array>;
	}): Promise<{ delegatePublicKey: string; delegatedKeyId: string }> {
		const { did, platformOrigin, platformName, rootSignFn } = params;

		const identity = await this.identities.findByDid(did);
		if (!identity) throw new Error('User has no identity.');

		const existing = await this.delegatedKeys.findByDidAndPlatformOrigin(did, platformOrigin);
		if (existing && !existing.revoked_at && !(existing.expires_at && new Date() > new Date(existing.expires_at))) {
			return {
				delegatePublicKey: existing.public_key,
				delegatedKeyId: String(existing.id.id)
			};
		}

		const delegateKeypair = await generateDeviceKeypair();
		const delegatePublicKeyMultibase = encodeMultibase(
			new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...delegateKeypair.publicKey])
		);

		const now = new Date();
		const delegationStatement = {
			did,
			delegate: delegatePublicKeyMultibase,
			scope: 'platform' as const,
			platform_origin: platformOrigin,
			platform_name: platformName,
			createdAt: now.toISOString()
		};
		const canonicalDelegation = canonicalize(delegationStatement);

		const signatureBytes = await rootSignFn(canonicalDelegation);
		const signatureMultibase = encodeMultibase(signatureBytes);

		let aegisDelegate: AegisBundle;
		try {
			aegisDelegate = await this.crypto.encryptDelegateKey(delegateKeypair.privateKey);
		} finally {
			// Always zero the raw private key, even if encryption fails
			delegateKeypair.privateKey.fill(0);
		}

		const dk = await this.delegatedKeys.createPlatformDelegatedKey({
			did,
			publicKey: delegatePublicKeyMultibase,
			platformOrigin,
			platformName,
			aegisDelegate,
			createdAt: now,
			signature: signatureMultibase,
			canonicalDelegation
		});
		this.logger.log(
			`Created delegated_key for ${did.slice(0, 20)}… origin=${platformOrigin}`
		);

		return {
			delegatePublicKey: delegatePublicKeyMultibase,
			delegatedKeyId: String(dk.id.id)
		};
	}

	/**
	 * Store a platform delegation with a pre-generated keypair and an
	 * externally-produced root signature (Syner two-round flow).
	 */
	async storePlatformDelegation(params: {
		did: string;
		platformOrigin: string;
		platformName: string;
		delegatePublicKeyMultibase: string;
		aegisDelegate: AegisBundle;
		signatureMultibase: string;
		canonicalDelegation: string;
		createdAt: Date;
	}): Promise<{ delegatePublicKey: string; delegatedKeyId: string }> {
		const identity = await this.identities.findByDid(params.did);
		if (!identity) throw new Error('User has no identity.');

		const existing = await this.delegatedKeys.findByDidAndPlatformOrigin(
			params.did,
			params.platformOrigin
		);
		if (existing && !existing.revoked_at && !(existing.expires_at && new Date() > new Date(existing.expires_at))) {
			return {
				delegatePublicKey: existing.public_key,
				delegatedKeyId: String(existing.id.id)
			};
		}

		const dk = await this.delegatedKeys.createPlatformDelegatedKey({
			did: params.did,
			publicKey: params.delegatePublicKeyMultibase,
			platformOrigin: params.platformOrigin,
			platformName: params.platformName,
			aegisDelegate: params.aegisDelegate,
			createdAt: params.createdAt,
			signature: params.signatureMultibase,
			canonicalDelegation: params.canonicalDelegation
		});

		return {
			delegatePublicKey: params.delegatePublicKeyMultibase,
			delegatedKeyId: String(dk.id.id)
		};
	}

	/**
	 * Root signing function for Aegis identities: decrypts the root seed
	 * with the user's password, signs, zeroes.
	 */
	createAegisRootSignFn(
		identity: IdentityRow,
		password: string
	): (statement: string) => Promise<Uint8Array> {
		return (statement: string) =>
			this.crypto.withSeed({
				bundle: this.crypto.aegisBundleFromIdentity(identity),
				password,
				action: (seed) => sign(statement, seed)
			});
	}

	/** Sign content with a platform delegation key (signing-as-a-service). */
	async signContent(
		did: string,
		platformOrigin: string,
		payload: Record<string, unknown>
	): Promise<{ signature: string; delegate_public_key: string; did: string; signed_at: string }> {
		const dk = await this.requireActiveDelegation(did, platformOrigin);
		const canonicalPayload = canonicalize(payload);
		const signatureMultibase = await this.crypto.withDelegateKey(
			dk.aegis_delegate as AegisBundle,
			async (seed) => encodeMultibase(await sign(canonicalPayload, seed))
		);
		return {
			signature: signatureMultibase,
			delegate_public_key: dk.public_key,
			did: dk.did,
			signed_at: new Date().toISOString()
		};
	}

	/** Sign a challenge for platform re-login. */
	async signChallenge(
		did: string,
		platformOrigin: string,
		challenge: string
	): Promise<{ signature: string; delegate_public_key: string; did: string }> {
		const dk = await this.requireActiveDelegation(did, platformOrigin);
		const signatureMultibase = await this.crypto.withDelegateKey(
			dk.aegis_delegate as AegisBundle,
			async (seed) => encodeMultibase(await sign(challenge, seed))
		);
		return {
			signature: signatureMultibase,
			delegate_public_key: dk.public_key,
			did: dk.did
		};
	}

	/** Active (non-revoked, non-expired) delegation for a DID + origin. */
	async getActiveDelegation(did: string, platformOrigin: string) {
		return this.delegatedKeys.findByDidAndPlatformOrigin(did, platformOrigin);
	}

	private async requireActiveDelegation(did: string, platformOrigin: string) {
		const dk = await this.delegatedKeys.findByDidAndPlatformOrigin(did, platformOrigin);
		if (!dk) throw new Error('No active platform delegation found.');
		if (dk.revoked_at) throw new Error('Platform delegation has been revoked.');
		if (dk.expires_at && new Date() > new Date(dk.expires_at)) {
			throw new Error('Platform delegation has expired.');
		}
		if (!dk.aegis_delegate) throw new Error('Platform delegation is missing encrypted key.');
		return dk;
	}

	/** Revoke a DID's delegation for a platform origin. */
	async revokeDelegation(did: string, platformOrigin: string): Promise<void> {
		const dk = await this.delegatedKeys.findByDidAndPlatformOrigin(did, platformOrigin);
		if (!dk) throw new Error('No platform delegation found for this origin.');
		if (dk.revoked_at) throw new Error('Platform delegation is already revoked.');
		await this.delegatedKeys.revoke(dk.id);
	}

	/** All platform delegations for a DID (public info, no private keys). */
	async getDelegations(did: string): Promise<
		Array<{
			delegate_public_key: string;
			platform_origin: string;
			platform_name: string;
			scope: string;
			created_at: string;
			revoked_at?: string;
			expires_at?: string;
		}>
	> {
		const keys = await this.delegatedKeys.findPlatformDelegationsByDid(did);
		return keys.map((k) => ({
			delegate_public_key: k.public_key,
			platform_origin: k.platform_origin ?? '',
			platform_name: k.platform_name || 'Unknown',
			scope: k.scope,
			created_at: new Date(k.created_at).toISOString(),
			revoked_at: k.revoked_at ? new Date(k.revoked_at).toISOString() : undefined,
			expires_at: k.expires_at ? new Date(k.expires_at).toISOString() : undefined
		}));
	}
}
