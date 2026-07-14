import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import {
	initCryptoWasm,
	createAegisBundle,
	decryptAegisBundle
} from '@slyng/idp-crypto';
import type { AegisBundle } from '@slyng/types';
import type { IdentityRow } from './idp.repository';

/**
 * Argon2id configuration for password hashes (PHC strings on
 * local_account). OWASP-recommended settings; identical to syr's
 * (apps/syr/app/src/lib/server/auth.ts) so imported accounts verify.
 */
const ARGON2_OPTIONS = {
	memoryCost: 65536, // 64 MiB
	timeCost: 3,
	parallelism: 4
};

/**
 * Crypto entry point for the local IdP. Initializes the WASM module at
 * bootstrap and owns the config-bound operations: password hashing, seed
 * handling (syr's seed-handler.ts) and delegate-key encryption under
 * PLATFORM_DELEGATE_SECRET (syr's platform-key-encryption.ts).
 *
 * Pure crypto functions (sign/verify/deriveDid/canonicalize/…) are
 * imported directly from `@slyng/idp-crypto` by callers — this service's
 * onModuleInit guarantees the WASM is ready before any controller runs.
 */
@Injectable()
export class IdpCryptoService implements OnModuleInit {
	private readonly logger = new Logger(IdpCryptoService.name);

	constructor(private readonly config: ConfigService) {}

	async onModuleInit(): Promise<void> {
		await initCryptoWasm();
		this.logger.log('IdP crypto WASM initialized');
	}

	// ── Passwords (PHC / Argon2id) ────────────────────────────────────

	async hashPassword(password: string): Promise<string> {
		return hash(password, ARGON2_OPTIONS);
	}

	async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
		try {
			return await verify(passwordHash, password, ARGON2_OPTIONS);
		} catch {
			return false;
		}
	}

	/**
	 * Burn comparable CPU on unknown-username logins so response timing
	 * doesn't reveal whether an account exists.
	 */
	async dummyVerify(): Promise<void> {
		await this.verifyPassword(
			'$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			'dummy-password'
		);
	}

	// ── Seed handling (syr: services/seed-handler.ts) ─────────────────

	/**
	 * Decrypt an Aegis bundle, run the action with the raw seed, then zero
	 * it — the seed never outlives the callback.
	 */
	async withSeed<T>(params: {
		bundle: AegisBundle;
		password: string;
		action: (seed: Uint8Array) => Promise<T>;
	}): Promise<T> {
		const seed = await decryptAegisBundle(params.bundle, params.password);
		try {
			return await params.action(seed);
		} finally {
			seed.fill(0);
		}
	}

	/** Reassemble the AegisBundle stored column-wise on an identity row. */
	aegisBundleFromIdentity(identity: IdentityRow): AegisBundle {
		if (
			!identity.aegis_salt ||
			!identity.aegis_nonce ||
			!identity.aegis_ct ||
			!identity.aegis_tag ||
			identity.aegis_kdf_mem == null ||
			identity.aegis_kdf_it == null ||
			identity.aegis_kdf_par == null
		) {
			throw new Error('Identity has no Aegis-protected seed');
		}
		return {
			pub: identity.public_key,
			salt: identity.aegis_salt,
			nonce: identity.aegis_nonce,
			ct: identity.aegis_ct,
			tag: identity.aegis_tag,
			kdf: {
				mem: identity.aegis_kdf_mem,
				it: identity.aegis_kdf_it,
				par: identity.aegis_kdf_par
			}
		};
	}

	// ── Delegate keys (syr: services/platform-key-encryption.ts) ──────

	private getDelegateSecret(): string {
		const secret = this.config.get<string>('PLATFORM_DELEGATE_SECRET');
		if (!secret || secret.length < 32) {
			// Fail closed: without a stable secret every stored delegate key
			// would become undecryptable after restart, silently breaking
			// signing-as-a-service.
			throw new Error(
				'PLATFORM_DELEGATE_SECRET must be set (min 32 chars) to use local identity features'
			);
		}
		return secret;
	}

	/** Encrypt a platform delegate private key (32-byte Ed25519 seed). */
	async encryptDelegateKey(privateKey: Uint8Array): Promise<AegisBundle> {
		if (privateKey.length !== 32) {
			throw new Error('Platform delegate key must be 32 bytes');
		}
		return createAegisBundle(privateKey, this.getDelegateSecret());
	}

	/** Run an action with the decrypted delegate key, then zero it. */
	async withDelegateKey<T>(
		bundle: AegisBundle,
		action: (seed: Uint8Array) => Promise<T>
	): Promise<T> {
		const seed = await decryptAegisBundle(bundle, this.getDelegateSecret());
		try {
			return await action(seed);
		} finally {
			seed.fill(0);
		}
	}
}
