import { Body, Controller, Get, HttpException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import {
	generateDeviceKeypair,
	encodeMultibase,
	decodeMultibase,
	ED25519_MULTICODEC_PREFIX,
	canonicalize,
	verify,
	parseDid,
	isValidSyrDid
} from '@syren/idp-crypto';
import { Public } from '../auth/public.decorator';
import { AccountService } from './account.service';
import { DelegationStoreService } from './delegation-store.service';
import { IdpCryptoService } from './idp-crypto.service';
import { IdentityRepository } from './idp.repository';
import { IndependentLoginChallengeDto, IndependentLoginVerifyDto } from '../dto';

/**
 * Independent login (P10) — self-custody sign-in to THIS instance. The user's
 * root key lives on their device (Syner); they never had a password here.
 *
 * It is the two-round delegation flow pointed at our own origin: round 1
 * mints a self-delegation statement (`platform_origin = PUBLIC_URL`) + a
 * device-signing challenge; the device root-signs it; round 2 verifies the
 * signature, provisions the identity + a server delegate + a session, and
 * stashes a one-shot bridge token the browser polls for. Same statement
 * format as `syr://delegate`, so a real syr Syner device can sign it.
 */
@ApiTags('auth')
@Controller('auth/independent-login')
@UseGuards(ThrottlerGuard)
export class IndependentLoginController {
	constructor(
		private readonly accountService: AccountService,
		private readonly store: DelegationStoreService,
		private readonly crypto: IdpCryptoService,
		private readonly identities: IdentityRepository
	) {}

	private oauthError(status: number, error: string, description: string): never {
		throw new HttpException({ error, error_description: description }, status);
	}

	@Public()
	@Throttle({ default: { limit: 10, ttl: 60_000 } })
	@Post('challenge')
	@ApiOperation({ summary: 'Round 1: mint a self-delegation challenge for a device to sign' })
	async challenge(@Body() body: IndependentLoginChallengeDto) {
		if (!isValidSyrDid(body.did)) {
			this.oauthError(400, 'invalid_did', 'did must be a valid did:syr');
		}

		// If this is a brand-new identity, respect the registration gate up
		// front (invite redemption itself happens atomically at verify time).
		const existing = await this.identities.findByDid(body.did);
		if (!existing) {
			const mode = await this.accountService.getRegistrationMode();
			if (mode === 'closed') {
				this.oauthError(403, 'registration_closed', 'Registration is closed on this instance');
			}
		}

		const base = this.accountService.getPublicUrl();
		const delegateKeypair = await generateDeviceKeypair();
		const delegatePublicKeyMultibase = encodeMultibase(
			new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...delegateKeypair.publicKey])
		);
		const now = new Date();
		const statement = {
			did: body.did,
			delegate: delegatePublicKeyMultibase,
			scope: 'platform' as const,
			platform_origin: base,
			platform_name: 'Syren',
			createdAt: now.toISOString()
		};
		const canonicalStatement = canonicalize(statement);

		let aegisDelegate;
		try {
			aegisDelegate = await this.crypto.encryptDelegateKey(delegateKeypair.privateKey);
		} finally {
			delegateKeypair.privateKey.fill(0);
		}

		const challengeId = randomUUID();
		await this.store.setIndependentLogin(challengeId, {
			message: canonicalStatement,
			delegate_public_key_multibase: delegatePublicKeyMultibase,
			aegis_delegate: aegisDelegate,
			did: body.did,
			invite_code: body.invite_code,
			display_name: body.display_name,
			created_at: now.getTime()
		});

		const params = new URLSearchParams({
			challenge: challengeId,
			instance: base,
			platform_name: 'Syren',
			platform_origin: base,
			did: body.did,
			delegate: delegatePublicKeyMultibase
		});
		return {
			challenge_id: challengeId,
			message: canonicalStatement,
			deeplink_url: `syr://delegate?${params.toString()}`,
			delegate_public_key: delegatePublicKeyMultibase,
			expires_in: this.store.registrationExpiresIn
		};
	}

	@Public()
	@Get('challenge/:id')
	@ApiOperation({ summary: 'The self-delegation statement the device must root-sign' })
	async payload(@Param('id') id: string) {
		const pending = await this.store.getIndependentLogin(id);
		if (!pending) throw new HttpException('Challenge not found or expired', 410);
		return {
			message: pending.message,
			platform_name: 'Syren',
			platform_origin: this.accountService.getPublicUrl(),
			delegate_public_key: pending.delegate_public_key_multibase,
			did: pending.did
		};
	}

	@Public()
	@Throttle({ default: { limit: 20, ttl: 60_000 } })
	@Post('verify')
	@ApiOperation({ summary: 'Round 2: device posts its root signature; server provisions the session' })
	async verify(@Body() body: IndependentLoginVerifyDto) {
		// Atomic consume — a challenge signs in exactly once.
		const pending = await this.store.consumeIndependentLogin(body.challenge_id);
		if (!pending) this.oauthError(410, 'challenge_expired', 'Challenge not found or expired');
		if (pending.did !== body.did) {
			this.oauthError(403, 'mismatched_did', 'did does not match the challenge');
		}

		let publicKey: Uint8Array;
		try {
			publicKey = parseDid(body.did).publicKey;
		} catch {
			this.oauthError(400, 'invalid_did', 'Malformed DID');
		}
		let sigBytes: Uint8Array;
		try {
			sigBytes = decodeMultibase(body.signature);
		} catch {
			this.oauthError(400, 'invalid_signature', 'Signature is not valid multibase');
		}
		const valid = await verify(pending.message, sigBytes, publicKey);
		if (!valid) {
			this.oauthError(403, 'invalid_signature', 'Signature does not verify against the DID');
		}

		const { bridge } = await this.accountService.loginSelfCustody({
			did: body.did,
			publicKey: body.did.replace(/^did:syr:/, ''),
			delegatePublicKeyMultibase: pending.delegate_public_key_multibase,
			aegisDelegate: pending.aegis_delegate,
			canonicalDelegation: pending.message,
			signatureMultibase: body.signature,
			inviteCode: pending.invite_code,
			displayName: pending.display_name
		});

		// Stash the bridge for the browser to poll — the signing device and the
		// browser awaiting sign-in may be different devices.
		await this.store.setIndependentResult(body.challenge_id, bridge);
		return { success: true as const };
	}

	@Public()
	@Get('status')
	@ApiOperation({ summary: 'Poll for the one-shot bridge token after the device signs' })
	async status(@Query('challenge_id') challengeId: string) {
		if (!challengeId) throw new HttpException('challenge_id is required', 400);
		const bridge = await this.store.consumeIndependentResult(challengeId);
		return { verified: !!bridge, bridge: bridge ?? null };
	}
}
