import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AegisBundle } from '@syren/types';
import { KvService } from './kv.service';

const KV_TYPE = 'platform_delegation';
const KV_KEYPAIR_TYPE = 'platform_delegation_keypair';
const KV_CHALLENGE_TYPE = 'platform_delegation_sign';
const KV_INDEPENDENT_TYPE = 'independent_login';
const KV_INDEPENDENT_RESULT_TYPE = 'independent_login_result';

/**
 * Pending platform delegation request — kv-persisted with TTL expiry.
 * Port of syr's server/platform-delegation-store.ts.
 */
export interface PendingPlatformDelegation {
	did: string;
	platform_origin: string;
	platform_name: string;
	callback_url: string;
	scopes: string[];
	state?: string;
	/** Local account id (string form) that must approve this request. */
	account_id: string;
	created_at: number;
	/** Set after user consents — the authorization code */
	code?: string;
	/** Set after a Syner device signs — the callback URL the consent page
	 * polls for and redirects to. */
	redirect_url?: string;
}

/**
 * Pending self-custody sign-in (independent login). The device signs the
 * self-delegation statement; on verify the server creates the identity +
 * a server delegate + a session. No external platform is involved —
 * platform_origin is always this instance's own PUBLIC_URL.
 */
export interface PendingIndependentLogin {
	/** JCS-canonical self-delegation statement string the device signs. */
	message: string;
	delegate_public_key_multibase: string;
	aegis_delegate: AegisBundle;
	did: string;
	invite_code?: string;
	display_name?: string;
	created_at: number;
}

/** Pre-generated delegate keypair between Round 1 and Round 2 (Syner). */
export interface PendingDelegateKeypair {
	delegation_id: string;
	delegate_public_key_multibase: string;
	aegis_delegate: AegisBundle;
	canonical_statement: string;
	did: string;
	platform_origin: string;
	platform_name: string;
	created_at: number;
}

/** Challenge stored for Syner signing — consumed atomically on verify. */
export interface StoredDelegationChallenge {
	message: string;
	delegation_id: string;
	account_id: string;
	created_at: number;
}

@Injectable()
export class DelegationStoreService {
	constructor(
		private readonly kv: KvService,
		private readonly config: ConfigService
	) {}

	/** Challenge/registration lifetime in seconds (syr default: 600). */
	get registrationExpiresIn(): number {
		return Number(this.config.get('PLATFORM_REGISTRATION_EXPIRES_IN', '600'));
	}

	/** Platform access-token lifetime in seconds (syr default: 86400). */
	get tokenExpiresIn(): number {
		return Number(this.config.get('PLATFORM_TOKEN_EXPIRES_IN', '86400'));
	}

	async setPendingDelegation(id: string, delegation: PendingPlatformDelegation): Promise<void> {
		await this.kv.set(KV_TYPE, id, delegation, this.registrationExpiresIn);
	}

	async getPendingDelegation(id: string): Promise<PendingPlatformDelegation | null> {
		return this.kv.get<PendingPlatformDelegation>(KV_TYPE, id);
	}

	async deletePendingDelegation(id: string): Promise<void> {
		await this.kv.delete(KV_TYPE, id);
	}

	/**
	 * Consume a pending delegation: validate code + origin + callback
	 * before deleting. Single-use by construction.
	 */
	async consumePendingDelegation(
		id: string,
		code: string,
		opts?: { platform_origin?: string; callback_url?: string }
	): Promise<PendingPlatformDelegation | null> {
		// Atomic compare-and-delete: consumes the registration only when the
		// code (+ origin/callback when supplied) all match, in a single
		// statement — so two concurrent token exchanges can't both mint, and a
		// wrong-code guess doesn't destroy the pending registration.
		return this.kv.consumeMatching<PendingPlatformDelegation>(KV_TYPE, id, {
			code,
			platform_origin: opts?.platform_origin,
			callback_url: opts?.callback_url
		});
	}

	// ── Syner two-round flow state (used from P10) ────────────────────

	async setPendingKeypair(id: string, keypair: PendingDelegateKeypair): Promise<void> {
		await this.kv.set(KV_KEYPAIR_TYPE, id, keypair, this.registrationExpiresIn);
	}

	async consumePendingKeypair(id: string): Promise<PendingDelegateKeypair | null> {
		return this.kv.getAndDelete<PendingDelegateKeypair>(KV_KEYPAIR_TYPE, id);
	}

	async setDelegationChallenge(id: string, challenge: StoredDelegationChallenge): Promise<void> {
		await this.kv.set(KV_CHALLENGE_TYPE, id, challenge, this.registrationExpiresIn);
	}

	async getDelegationChallenge(id: string): Promise<StoredDelegationChallenge | null> {
		return this.kv.get<StoredDelegationChallenge>(KV_CHALLENGE_TYPE, id);
	}

	async consumeDelegationChallenge(id: string): Promise<StoredDelegationChallenge | null> {
		return this.kv.getAndDelete<StoredDelegationChallenge>(KV_CHALLENGE_TYPE, id);
	}

	// ── Independent login (self-custody sign-in) ──────────────────────────

	/** Callback-token lifetime (seconds) — the window the browser has to poll
	 * after the device signs. Short by design. */
	get callbackTokenExpiresIn(): number {
		return Number(this.config.get('INDEPENDENT_LOGIN_CALLBACK_TTL', '300'));
	}

	async setIndependentLogin(id: string, pending: PendingIndependentLogin): Promise<void> {
		await this.kv.set(KV_INDEPENDENT_TYPE, id, pending, this.registrationExpiresIn);
	}

	async getIndependentLogin(id: string): Promise<PendingIndependentLogin | null> {
		return this.kv.get<PendingIndependentLogin>(KV_INDEPENDENT_TYPE, id);
	}

	async consumeIndependentLogin(id: string): Promise<PendingIndependentLogin | null> {
		return this.kv.getAndDelete<PendingIndependentLogin>(KV_INDEPENDENT_TYPE, id);
	}

	/** Stash the one-shot bridge token the browser polls for after the device
	 * completes verification. */
	async setIndependentResult(challengeId: string, bridge: string): Promise<void> {
		await this.kv.set(
			KV_INDEPENDENT_RESULT_TYPE,
			challengeId,
			{ bridge },
			this.callbackTokenExpiresIn
		);
	}

	async consumeIndependentResult(challengeId: string): Promise<string | null> {
		const result = await this.kv.getAndDelete<{ bridge: string }>(
			KV_INDEPENDENT_RESULT_TYPE,
			challengeId
		);
		return result?.bridge ?? null;
	}
}
