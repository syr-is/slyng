import {
	Body,
	Controller,
	Get,
	HttpException,
	Param,
	Post,
	Query,
	Req,
	UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import {
	generateDeviceKeypair,
	encodeMultibase,
	decodeMultibase,
	ED25519_MULTICODEC_PREFIX,
	canonicalize,
	verify,
	parseDid
} from '@slyng/idp-crypto';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { AccountService } from './account.service';
import { DelegationStoreService, type PendingPlatformDelegation } from './delegation-store.service';
import { IdpCryptoService } from './idp-crypto.service';
import { IdpJwtService } from './idp-jwt.service';
import { PlatformService } from './platform.service';
import { PlatformTokenGuard, type PlatformTokenContext } from './platform-token.guard';
import {
	IdentityRepository,
	IdpProfileRepository,
	LocalAccountRepository
} from './idp.repository';
import {
	DelegationVerifyDto,
	PlatformChallengeDto,
	PlatformConsentApproveDto,
	PlatformConsentDirectDto,
	PlatformRegisterDto,
	PlatformRevokeDto,
	PlatformSignDto,
	PlatformTokenDto
} from '../dto';

type AuthedRequest = Request & { user?: { did?: string } };

/**
 * Platform delegation server — the IdP side of the flow slyng itself
 * consumes as a client (auth.service.ts). External platforms (other
 * slyngs, syr-family apps) authenticate local users through these
 * endpoints. Route paths and response shapes are syr-identical
 * (routes/api/platform/* in the syr repo), OAuth-style error bodies
 * included.
 */
@ApiTags('platform')
@Controller('platform')
export class PlatformController {
	constructor(
		private readonly platform: PlatformService,
		private readonly store: DelegationStoreService,
		private readonly jwt: IdpJwtService,
		private readonly crypto: IdpCryptoService,
		private readonly accountService: AccountService,
		private readonly accounts: LocalAccountRepository,
		private readonly identities: IdentityRepository,
		private readonly profiles: IdpProfileRepository
	) {}

	private oauthError(status: number, error: string, description: string): never {
		throw new HttpException({ error, error_description: description }, status);
	}

	// ── Registration + token exchange (called by external platforms) ──

	@Public()
	@UseGuards(ThrottlerGuard)
	@Throttle({ default: { limit: 10, ttl: 60_000 } })
	@Post('register')
	@ApiOperation({ summary: 'Initiate platform delegation — returns consent URL' })
	async register(@Body() body: PlatformRegisterDto) {
		const identity = await this.identities.findByDid(body.did);
		if (!identity) {
			this.oauthError(404, 'unknown_did', 'No identity found for this DID on this instance');
		}
		const account = await this.accounts.findByDid(body.did);
		if (!account) {
			this.oauthError(404, 'unknown_did', 'User associated with this DID no longer exists');
		}

		const challengeId = randomUUID();
		await this.store.setPendingDelegation(challengeId, {
			did: body.did,
			platform_origin: body.platform_origin,
			platform_name: body.platform_name,
			callback_url: body.callback_url,
			scopes: body.scopes,
			state: body.state,
			account_id: String(account.id),
			created_at: Date.now()
		});

		return {
			challenge_id: challengeId,
			consent_url: `${this.accountService.getPublicUrl()}/auth/platform-consent?challenge=${challengeId}`,
			expires_in: this.store.registrationExpiresIn
		};
	}

	@Public()
	@UseGuards(ThrottlerGuard)
	@Throttle({ default: { limit: 20, ttl: 60_000 } })
	@Post('token')
	@ApiOperation({ summary: 'Exchange an authorization code for a platform access token' })
	async token(@Body() body: PlatformTokenDto) {
		// Atomic single-use consume; validates code + origin + callback
		const registration = await this.store.consumePendingDelegation(body.delegation_id, body.code, {
			platform_origin: body.platform_origin,
			callback_url: body.callback_url
		});
		if (!registration) {
			this.oauthError(
				400,
				'invalid_code',
				'Registration not found, expired, or code/origin/callback mismatch'
			);
		}

		const dk = await this.platform.getActiveDelegation(
			registration.did,
			registration.platform_origin
		);
		if (!dk) {
			this.oauthError(500, 'server_error', 'Platform delegation not found after consent');
		}

		const accessToken = this.jwt.generateAccessToken(
			{ userId: registration.did, sessionId: `platform:${String(dk.id.id)}` },
			`${this.store.tokenExpiresIn}s`
		);

		return {
			access_token: accessToken,
			token_type: 'Bearer' as const,
			expires_in: this.store.tokenExpiresIn,
			did: registration.did,
			delegate_public_key: dk.public_key,
			scopes: registration.scopes
		};
	}

	// ── Signing-as-a-service (platform token auth) ────────────────────

	@Public()
	@UseGuards(PlatformTokenGuard)
	@Post('sign')
	@ApiOperation({ summary: 'Sign a JCS-canonicalized payload with the delegate key' })
	async sign(@Req() req: Request & { platform?: PlatformTokenContext }, @Body() body: PlatformSignDto) {
		const ctx = req.platform!;
		try {
			return await this.platform.signContent(
				ctx.did,
				ctx.delegatedKey.platform_origin!,
				body.payload
			);
		} catch (err) {
			this.oauthError(400, 'sign_failed', err instanceof Error ? err.message : 'Signing failed');
		}
	}

	@Public()
	@UseGuards(PlatformTokenGuard)
	@Post('challenge')
	@ApiOperation({ summary: 'Sign a re-login challenge with the delegate key' })
	async challenge(
		@Req() req: Request & { platform?: PlatformTokenContext },
		@Body() body: PlatformChallengeDto
	) {
		const ctx = req.platform!;
		if (ctx.did !== body.did || ctx.delegatedKey.platform_origin !== body.platform_origin) {
			this.oauthError(403, 'forbidden', 'Token does not match the requested delegation');
		}
		try {
			return await this.platform.signChallenge(body.did, body.platform_origin, body.challenge);
		} catch (err) {
			this.oauthError(400, 'sign_failed', err instanceof Error ? err.message : 'Signing failed');
		}
	}

	// ── Public verification surface ───────────────────────────────────

	@Public()
	@Get('delegations')
	@ApiOperation({ summary: "List a DID's platform delegations (public verification info)" })
	async delegations(@Query('did') did: string) {
		if (!did) this.oauthError(400, 'invalid_request', 'did query parameter is required');
		return this.platform.getDelegations(did);
	}

	// ── User-facing management (slyng session auth) ───────────────────

	@SkipServerAccess()
	@Post('revoke')
	@ApiOperation({ summary: 'Revoke one of your platform delegations' })
	async revoke(@Req() req: AuthedRequest, @Body() body: PlatformRevokeDto) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		try {
			await this.platform.revokeDelegation(did, body.platform_origin);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Revoke failed', 400);
		}
		return { status: 'success' };
	}

	// ── Consent (slyng session auth; SPA-driven) ──────────────────────

	/** Resolve the local account of the logged-in user, or 403. */
	private async requireLocalAccount(req: AuthedRequest) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		const account = await this.accounts.findByDid(did);
		if (!account) {
			throw new HttpException(
				'Only accounts hosted on this instance can approve delegations here',
				403
			);
		}
		return account;
	}

	private async consentMetadata(reg: PendingPlatformDelegation) {
		const identity = await this.identities.findByDid(reg.did);
		const account = await this.accounts.findByDid(reg.did);
		const profile = account ? await this.profiles.findByAccountId(account.id) : null;
		const hasAegis = !!(
			identity?.aegis_ct &&
			identity?.aegis_salt &&
			identity?.aegis_nonce &&
			identity?.aegis_tag
		);
		return {
			platform_name: reg.platform_name,
			platform_origin: reg.platform_origin,
			scopes: reg.scopes,
			did: reg.did,
			display_name: profile?.display_name ?? account?.username ?? null,
			avatar_url: profile?.avatar_url ?? null,
			has_aegis: hasAegis
		};
	}

	@SkipServerAccess()
	@Get('consent/:challengeId')
	@ApiOperation({ summary: 'Consent metadata for a pending delegation request' })
	async consentInfo(@Req() req: AuthedRequest, @Param('challengeId') challengeId: string) {
		const account = await this.requireLocalAccount(req);
		const reg = await this.store.getPendingDelegation(challengeId);
		if (!reg) throw new HttpException('Challenge not found or expired', 400);
		if (reg.account_id !== String(account.id)) {
			throw new HttpException('This delegation request is for a different user', 403);
		}
		return { challenge_id: challengeId, ...(await this.consentMetadata(reg)) };
	}

	/**
	 * Direct-entry consent: a platform linked straight to the consent page
	 * with query params instead of pre-registering. Creates the pending
	 * delegation for the logged-in user. Port of the else-branch in syr's
	 * consent +page.server.ts load, callback-origin check included.
	 */
	@SkipServerAccess()
	@Post('consent')
	@ApiOperation({ summary: 'Create a pending delegation from direct consent-page entry' })
	async consentDirect(@Req() req: AuthedRequest, @Body() body: PlatformConsentDirectDto) {
		const account = await this.requireLocalAccount(req);

		let parsedOrigin: URL;
		let parsedCallback: URL;
		try {
			parsedOrigin = new URL(body.platform_origin);
			parsedCallback = new URL(body.callback_url);
		} catch {
			throw new HttpException('Invalid platform_origin or callback_url', 400);
		}
		if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
			throw new HttpException('platform_origin must use http or https', 400);
		}
		if (!['http:', 'https:'].includes(parsedCallback.protocol)) {
			throw new HttpException('callback_url must use http or https', 400);
		}
		if (parsedCallback.origin !== parsedOrigin.origin) {
			throw new HttpException('callback_url origin must match platform_origin', 400);
		}

		const challengeId = randomUUID();
		const reg: PendingPlatformDelegation = {
			did: account.did!,
			platform_origin: body.platform_origin,
			platform_name: body.platform_name || parsedOrigin.hostname,
			callback_url: body.callback_url,
			scopes: (body.scopes || 'identity:read,profile:read').split(',').map((s) => s.trim()),
			state: body.state,
			account_id: String(account.id),
			created_at: Date.now()
		};
		await this.store.setPendingDelegation(challengeId, reg);
		return { challenge_id: challengeId, ...(await this.consentMetadata(reg)) };
	}

	@SkipServerAccess()
	@Post('consent/:challengeId/approve')
	@ApiOperation({ summary: 'Approve a delegation (Aegis password unlock) — returns redirect URL' })
	async consentApprove(
		@Req() req: AuthedRequest,
		@Param('challengeId') challengeId: string,
		@Body() body: PlatformConsentApproveDto
	) {
		const account = await this.requireLocalAccount(req);
		const reg = await this.store.getPendingDelegation(challengeId);
		if (!reg) throw new HttpException('Challenge expired', 400);
		if (reg.account_id !== String(account.id)) {
			throw new HttpException('This delegation request is for a different user', 403);
		}
		const identity = await this.identities.findByDid(reg.did);
		if (!identity) throw new HttpException('No identity found', 400);

		try {
			await this.platform.createPlatformDelegation({
				did: identity.did,
				platformOrigin: reg.platform_origin,
				platformName: reg.platform_name,
				rootSignFn: this.platform.createAegisRootSignFn(identity, body.password)
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed';
			if (msg.includes('decryption') || msg.includes('Aegis') || msg.includes('aead')) {
				throw new HttpException('Incorrect password', 400);
			}
			throw new HttpException(msg, 500);
		}

		const code = randomUUID();
		reg.code = code;
		await this.store.setPendingDelegation(challengeId, reg);

		const cb = new URL(reg.callback_url);
		cb.searchParams.set('code', code);
		cb.searchParams.set('delegation_id', challengeId);
		if (reg.state) cb.searchParams.set('state', reg.state);
		return { redirect_url: cb.toString() };
	}

	@SkipServerAccess()
	@Post('consent/:challengeId/deny')
	@ApiOperation({ summary: 'Deny a delegation request — returns redirect URL' })
	async consentDeny(@Req() req: AuthedRequest, @Param('challengeId') challengeId: string) {
		const account = await this.requireLocalAccount(req);
		const reg = await this.store.getPendingDelegation(challengeId);
		if (!reg) throw new HttpException('Challenge expired', 400);
		if (reg.account_id !== String(account.id)) {
			throw new HttpException('This delegation request is for a different user', 403);
		}
		await this.store.deletePendingDelegation(challengeId);

		const cb = new URL(reg.callback_url);
		cb.searchParams.set('error', 'consent_denied');
		if (reg.state) cb.searchParams.set('state', reg.state);
		return { redirect_url: cb.toString() };
	}

	// ── Syner two-round delegation (self-custody consent; P10) ────────
	//
	// Self-custody accounts (no Aegis seed) can't approve a delegation with
	// a password — the root key lives on the user's device. Round 1 (here)
	// generates the delegate keypair + the canonical delegation statement
	// and hands back a deep link + QR payload; the device signs the
	// statement with the root key and posts it to `delegation-verify`
	// (round 2). The consent page polls `consent/:id/status` until a
	// redirect URL appears.

	@SkipServerAccess()
	@Post('consent/:challengeId/syner-challenge')
	@ApiOperation({ summary: 'Round 1: mint a device-signing challenge for a self-custody delegation' })
	async synerChallenge(@Req() req: AuthedRequest, @Param('challengeId') challengeId: string) {
		const account = await this.requireLocalAccount(req);
		const reg = await this.store.getPendingDelegation(challengeId);
		if (!reg) throw new HttpException('Challenge expired', 400);
		if (reg.account_id !== String(account.id)) {
			throw new HttpException('This delegation request is for a different user', 403);
		}

		const delegateKeypair = await generateDeviceKeypair();
		const delegatePublicKeyMultibase = encodeMultibase(
			new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...delegateKeypair.publicKey])
		);
		const now = new Date();
		const statement = {
			did: reg.did,
			delegate: delegatePublicKeyMultibase,
			scope: 'platform' as const,
			platform_origin: reg.platform_origin,
			platform_name: reg.platform_name,
			createdAt: now.toISOString()
		};
		const canonicalStatement = canonicalize(statement);

		let aegisDelegate;
		try {
			aegisDelegate = await this.crypto.encryptDelegateKey(delegateKeypair.privateKey);
		} finally {
			delegateKeypair.privateKey.fill(0);
		}

		// Key the pending keypair by the SIGNING challenge id (not the consent
		// id) so it's immutable per challenge: re-minting `syner-challenge`
		// creates a NEW signing challenge with its OWN keypair, and a device
		// that signed an earlier statement can never have its signature stored
		// against a later (mismatched) delegate key.
		const signingChallengeId = randomUUID();
		await this.store.setPendingKeypair(signingChallengeId, {
			delegation_id: challengeId,
			delegate_public_key_multibase: delegatePublicKeyMultibase,
			aegis_delegate: aegisDelegate,
			canonical_statement: canonicalStatement,
			did: reg.did,
			platform_origin: reg.platform_origin,
			platform_name: reg.platform_name,
			created_at: now.getTime()
		});
		await this.store.setDelegationChallenge(signingChallengeId, {
			message: canonicalStatement,
			delegation_id: challengeId,
			account_id: String(account.id),
			created_at: now.getTime()
		});

		const params = new URLSearchParams({
			challenge: signingChallengeId,
			instance: this.accountService.getPublicUrl(),
			platform_name: reg.platform_name,
			platform_origin: reg.platform_origin,
			did: reg.did,
			delegate: delegatePublicKeyMultibase
		});
		return {
			challenge_id: signingChallengeId,
			message: canonicalStatement,
			deeplink_url: `syr://delegate?${params.toString()}`,
			delegate_public_key: delegatePublicKeyMultibase,
			expires_in: this.store.registrationExpiresIn
		};
	}

	@Public()
	@Get('delegation-challenge/:id/payload')
	@ApiOperation({ summary: 'The delegation statement the signing device must root-sign' })
	async delegationPayload(@Param('id') id: string) {
		const challenge = await this.store.getDelegationChallenge(id);
		if (!challenge) throw new HttpException('Challenge not found or expired', 410);
		let stmt: {
			delegate?: string;
			platform_name?: string;
			platform_origin?: string;
			did?: string;
		};
		try {
			stmt = JSON.parse(challenge.message);
		} catch {
			throw new HttpException('Corrupt challenge', 500);
		}
		return {
			message: challenge.message,
			platform_name: stmt.platform_name ?? '',
			platform_origin: stmt.platform_origin ?? '',
			delegate_public_key: stmt.delegate ?? '',
			did: stmt.did ?? ''
		};
	}

	@Public()
	@UseGuards(ThrottlerGuard)
	@Throttle({ default: { limit: 30, ttl: 60_000 } })
	@Post('delegation-verify')
	@ApiOperation({ summary: 'Round 2: the device posts its root signature over the statement' })
	async delegationVerify(@Body() body: DelegationVerifyDto) {
		const challenge = await this.store.consumeDelegationChallenge(body.challenge_id);
		if (!challenge) this.oauthError(410, 'challenge_expired', 'Challenge not found or expired');

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
		const valid = await verify(challenge.message, sigBytes, publicKey);
		if (!valid) this.oauthError(403, 'invalid_signature', 'Signature does not verify against the DID');

		// Fail-closed: the DID embedded in the signed statement must be the DID
		// whose key we just verified against (don't rely only on the transitive
		// account binding below).
		let statementDid: string | undefined;
		try {
			statementDid = JSON.parse(challenge.message)?.did;
		} catch {
			this.oauthError(500, 'corrupt_challenge', 'Stored challenge is malformed');
		}
		if (statementDid !== body.did) {
			this.oauthError(403, 'mismatched_did', 'Signed statement is for a different DID');
		}

		const identity = await this.identities.findByDid(body.did);
		if (!identity) this.oauthError(404, 'unknown_did', 'No identity found for this DID');

		// The signer must be the account that owns the consent request.
		const account = await this.accounts.findByDid(body.did);
		if (!account || String(account.id) !== challenge.account_id) {
			this.oauthError(403, 'mismatched_did', 'This challenge belongs to a different account');
		}

		// The keypair is keyed by THIS signing challenge id (not the consent id),
		// so it's the exact delegate generated for the statement that was signed.
		const keypair = await this.store.consumePendingKeypair(body.challenge_id);
		if (!keypair) this.oauthError(410, 'keypair_expired', 'Pending delegate key expired');
		// Belt-and-braces: the stored delegate must belong to the statement we
		// verified the signature over.
		if (keypair.canonical_statement !== challenge.message) {
			this.oauthError(409, 'statement_mismatch', 'Delegate key does not match the signed statement');
		}
		const reg = await this.store.getPendingDelegation(challenge.delegation_id);
		if (!reg) this.oauthError(410, 'registration_expired', 'Delegation registration expired');

		let callbackUrl: URL;
		try {
			callbackUrl = new URL(reg.callback_url);
		} catch {
			this.oauthError(400, 'invalid_callback', 'Stored callback_url is malformed');
		}

		await this.platform.storePlatformDelegation({
			did: body.did,
			platformOrigin: keypair.platform_origin,
			platformName: keypair.platform_name,
			delegatePublicKeyMultibase: keypair.delegate_public_key_multibase,
			aegisDelegate: keypair.aegis_delegate,
			signatureMultibase: body.signature,
			canonicalDelegation: keypair.canonical_statement,
			createdAt: new Date(keypair.created_at)
		});

		const code = randomUUID();
		callbackUrl.searchParams.set('code', code);
		callbackUrl.searchParams.set('delegation_id', challenge.delegation_id);
		if (reg.state) callbackUrl.searchParams.set('state', reg.state);
		reg.code = code;
		reg.redirect_url = callbackUrl.toString();
		await this.store.setPendingDelegation(challenge.delegation_id, reg);

		return { success: true };
	}

	@SkipServerAccess()
	@Get('consent/:challengeId/status')
	@ApiOperation({ summary: 'Poll whether a self-custody delegation has been signed' })
	async consentStatus(@Req() req: AuthedRequest, @Param('challengeId') challengeId: string) {
		const account = await this.requireLocalAccount(req);
		const reg = await this.store.getPendingDelegation(challengeId);
		if (!reg) throw new HttpException('Challenge expired', 400);
		if (reg.account_id !== String(account.id)) {
			throw new HttpException('This delegation request is for a different user', 403);
		}
		return { signed: !!reg.redirect_url, redirect_url: reg.redirect_url ?? null };
	}
}
