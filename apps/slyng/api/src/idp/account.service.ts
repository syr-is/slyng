import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
	generateRootKeypair,
	createAegisBundle,
	deriveDid,
	sign
} from '@slyng/idp-crypto';
import type {
	AegisBundle,
	InviteCodeValue,
	LocalRegisterRequest,
	RegistrationMode
} from '@slyng/types';
import { AuthService } from '../auth/auth.service';
import { IdpCryptoService } from './idp-crypto.service';
import { IdpJwtService } from './idp-jwt.service';
import { KvService } from './kv.service';
import { PlatformService } from './platform.service';
import {
	DelegatedKeyRepository,
	IdentityRepository,
	IdpProfileRepository,
	LocalAccountRepository
} from './idp.repository';

const INSTANCE_CONFIG_TYPE = 'instance_config';
const KEY_REGISTRATION_MODE = 'registration_mode';
const INVITE_CODE_TYPE = 'invite_code';

/**
 * Local sessions live as long as the slyng_session cookie (30 days) —
 * unlike remote syr platform tokens (24 h), there is no upstream token to
 * outlive since we are the upstream.
 */
const LOCAL_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Local account registration + login — slyng acting as a syr instance.
 * Flow ported from syr's auth.controller.ts register()/login() +
 * identity.controller.ts createIdentityAegis(), with one addition: a
 * "self-delegation" (platform_origin = our own PUBLIC_URL) is provisioned
 * at registration while the root seed is still in memory, so local
 * sessions carry a real delegate key exactly like federated ones.
 */
@Injectable()
export class AccountService {
	private readonly logger = new Logger(AccountService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly crypto: IdpCryptoService,
		private readonly platform: PlatformService,
		private readonly jwt: IdpJwtService,
		private readonly kv: KvService,
		private readonly accounts: LocalAccountRepository,
		private readonly identities: IdentityRepository,
		private readonly profiles: IdpProfileRepository,
		private readonly delegatedKeys: DelegatedKeyRepository,
		private readonly authService: AuthService
	) {}

	getPublicUrl(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	async getRegistrationMode(): Promise<RegistrationMode> {
		const val = await this.kv.get<string>(INSTANCE_CONFIG_TYPE, KEY_REGISTRATION_MODE);
		if (val === 'open' || val === 'invite_only' || val === 'closed') return val;
		const envVal = this.config.get<string>('SLYNG_REGISTRATION_MODE');
		if (envVal === 'open' || envVal === 'invite_only' || envVal === 'closed') return envVal;
		return 'open';
	}

	/**
	 * Register a local account: Argon2id password hash → root Ed25519
	 * keypair → Aegis bundle → did:syr → self-delegation → chat user row →
	 * session. Rolls back everything created so far on any step failure.
	 */
	async register(
		data: LocalRegisterRequest
	): Promise<{ did: string; sessionId: string; bridge: string }> {
		const { username, password, display_name, invite_code } = data;

		const mode = await this.getRegistrationMode();
		if (mode === 'closed') {
			throw new HttpException('Registration is closed', 403);
		}

		// Check username before redeeming an invite code so we don't waste a use
		if (await this.accounts.usernameExists(username)) {
			throw new HttpException('Username already exists', 409);
		}

		let inviteRedeemed: string | null = null;
		if (mode === 'invite_only') {
			if (!invite_code) throw new HttpException('Invite code required', 403);
			const entry = await this.kv.getEntry(INVITE_CODE_TYPE, invite_code);
			if (!entry) throw new HttpException('Invalid invite code', 403);
			const value = entry.value as InviteCodeValue;
			if (value.max_uses !== null && value.uses >= value.max_uses) {
				throw new HttpException('Invite code exhausted', 403);
			}
			if (value.reserved_username && username !== value.reserved_username) {
				throw new HttpException(
					`This invite code is reserved for username "${value.reserved_username}"`,
					403
				);
			}
			try {
				await this.kv.atomicIncrementField(
					INVITE_CODE_TYPE,
					invite_code,
					'uses',
					1,
					0,
					value.max_uses ?? undefined
				);
				inviteRedeemed = invite_code;
			} catch (err) {
				if (err instanceof Error && err.message === 'QUOTA_EXCEEDED') {
					throw new HttpException('Invite code exhausted', 403);
				}
				throw err;
			}
		}

		const password_hash = await this.crypto.hashPassword(password);
		const now = new Date();

		const account = await this.accounts.create({
			username,
			password_hash,
			role: 'USER',
			created_at: now,
			updated_at: now
		});

		// Undo ledger: each created resource pushes its cleanup; on failure
		// everything unwinds in reverse, then the invite use and the account
		// row are restored/removed. Mirrors syr's rollback chains.
		const undoSteps: Array<() => Promise<unknown>> = [];
		const runRollback = async () => {
			for (const step of [...undoSteps].reverse()) {
				try {
					await step();
				} catch (e) {
					this.logger.error(`Registration rollback step failed: ${e}`);
				}
			}
			if (inviteRedeemed) {
				try {
					await this.kv.atomicIncrementField(INVITE_CODE_TYPE, inviteRedeemed, 'uses', -1, 0);
				} catch (e) {
					this.logger.error(`Registration rollback: failed to restore invite use: ${e}`);
				}
			}
			try {
				await this.accounts.delete(account.id);
			} catch (e) {
				this.logger.error(`Registration rollback: failed to delete account: ${e}`);
			}
		};

		const rootKeypair = await generateRootKeypair();
		try {
			// Identity: Aegis bundle + DID + self-delegation, all within the
			// lifetime of the in-memory seed.
			const bundle = await createAegisBundle(rootKeypair.privateKey, password);
			const did = deriveDid(rootKeypair.publicKey);

			await this.identities.createIdentityAegis({
				did,
				publicKey: bundle.pub,
				aegisBundle: bundle,
				accountId: account.id,
				now
			});
			undoSteps.push(() => this.identities.deleteByDid(did));
			await this.accounts.merge(account.id, { did, updated_at: now });

			const delegation = await this.platform.createPlatformDelegation({
				did,
				platformOrigin: this.getPublicUrl(),
				platformName: 'Slyng',
				rootSignFn: async (statement) => sign(statement, rootKeypair.privateKey)
			});
			undoSteps.push(() => this.delegatedKeys.deleteByDid(did));

			await this.profiles.create({
				account_id: account.id,
				display_name,
				identity_host_url: this.getPublicUrl(),
				created_at: now,
				updated_at: now
			});
			undoSteps.push(() => this.profiles.deleteByAccountId(account.id));

			const sessionId = await this.createLocalSession(
				did,
				delegation.delegatePublicKey,
				delegation.delegatedKeyId
			);
			const bridge = this.authService.issueBridgeToken(sessionId);
			this.logger.log(`Local account registered: ${username} (${did.slice(0, 24)}…)`);
			return { did, sessionId, bridge };
		} catch (err) {
			await runRollback();
			this.logger.error(`Registration failed for ${username}: ${err}`);
			if (err instanceof HttpException) throw err;
			throw new HttpException('Registration failed', 500);
		} finally {
			rootKeypair.privateKey.fill(0);
		}
	}

	/** Login with username/password against a local account. */
	async login(
		username: string,
		password: string
	): Promise<{ did: string; sessionId: string; bridge: string }> {
		const account = await this.accounts.findByUsername(username);
		if (!account) {
			// Burn comparable CPU so timing doesn't reveal account existence
			await this.crypto.dummyVerify();
			throw new HttpException('Invalid credentials', 401);
		}

		const valid = await this.crypto.verifyPassword(account.password_hash, password);
		if (!valid) throw new HttpException('Invalid credentials', 401);

		if (!account.did) throw new HttpException('Invalid credentials', 401);
		const identity = await this.identities.findByDid(account.did);
		if (!identity) throw new HttpException('Invalid credentials', 401);

		// Ensure an active self-delegation; re-provision if revoked/missing
		// (we hold the password, so the root key is available).
		const delegation = await this.platform.createPlatformDelegation({
			did: account.did,
			platformOrigin: this.getPublicUrl(),
			platformName: 'Slyng',
			rootSignFn: this.platform.createAegisRootSignFn(identity, password)
		});

		const sessionId = await this.createLocalSession(
			account.did,
			delegation.delegatePublicKey,
			delegation.delegatedKeyId
		);
		const bridge = this.authService.issueBridgeToken(sessionId);
		return { did: account.did, sessionId, bridge };
	}

	/**
	 * Self-custody sign-in (independent login). The device has already proven
	 * possession of the root key by signing the self-delegation statement;
	 * here we (a) create the identity + account + profile on first sight
	 * (no Aegis columns — the seed lives on the device), (b) persist the
	 * server delegate key the device authorized (this is what powers
	 * server-side content signing, exactly as for password accounts), and
	 * (c) mint a session. Idempotent: a returning self-custody user just
	 * re-provisions the delegation + session.
	 */
	async loginSelfCustody(params: {
		did: string;
		publicKey: string;
		delegatePublicKeyMultibase: string;
		aegisDelegate: AegisBundle;
		canonicalDelegation: string;
		signatureMultibase: string;
		inviteCode?: string;
		displayName?: string;
	}): Promise<{ did: string; sessionId: string; bridge: string }> {
		const { did } = params;
		const now = new Date();

		const existingIdentity = await this.identities.findByDid(did);
		let account = await this.accounts.findByDid(did);

		if (!existingIdentity) {
			// First-time self-custody sign-in provisions a fresh account. Gate
			// on registration mode + redeem an invite, mirroring register().
			const mode = await this.getRegistrationMode();
			if (mode === 'closed') throw new HttpException('Registration is closed', 403);

			let inviteRedeemed: string | null = null;
			if (mode === 'invite_only') {
				inviteRedeemed = await this.redeemInvite(params.inviteCode);
			}

			const username = await this.deriveUniqueSelfCustodyUsername(did);
			// A random, unrecoverable placeholder hash — self-custody accounts
			// never authenticate by password (the login proof is the device
			// signature), but local_account.password_hash is NOT NULL.
			const placeholder = await this.crypto.hashPassword(randomBytes(32).toString('hex'));
			account = await this.accounts.create({
				username,
				password_hash: placeholder,
				role: 'USER',
				created_at: now,
				updated_at: now
			});

			let createdIdentity: { id: unknown } | null = null;
			try {
				createdIdentity = await this.identities.createIdentityExternal({
					did,
					publicKey: params.publicKey,
					accountId: account.id,
					now
				});
				// identity.did is UNIQUE — this merge is what claims local_account.did.
				await this.accounts.merge(account.id, { did, updated_at: now });
				await this.profiles.create({
					account_id: account.id,
					display_name: params.displayName,
					identity_host_url: this.getPublicUrl(),
					created_at: now,
					updated_at: now
				});
			} catch (err) {
				// Roll back ONLY what THIS request created — never delete by DID
				// globally (a concurrent sign-in for the same DID may hold the live
				// identity, and a blind deleteByDid would destroy it).
				if (createdIdentity) {
					await this.identities.delete(createdIdentity.id as never).catch(() => {});
				}
				await this.profiles.deleteByAccountId(account.id).catch(() => {});
				await this.accounts.delete(account.id).catch(() => {});
				if (inviteRedeemed) {
					await this.kv
						.atomicIncrementField(INVITE_CODE_TYPE, inviteRedeemed, 'uses', -1, 0)
						.catch(() => {});
				}
				// If another concurrent sign-in already provisioned this DID (UNIQUE
				// violation on identity.did), that's success from the user's POV —
				// fall through and issue a session against the existing identity
				// instead of throwing (and never bricking the DID).
				const raced = await this.identities.findByDid(did);
				if (!raced) {
					this.logger.error(`Self-custody provisioning failed for ${did}: ${err}`);
					throw new HttpException('Failed to create self-custody account', 500);
				}
				this.logger.warn(`Self-custody provisioning raced for ${did}; reusing existing identity`);
			}
		}

		// Persist the server delegate key the device just authorized. Reuses an
		// existing active delegation for our origin if the user already has one.
		const delegation = await this.platform.storePlatformDelegation({
			did,
			platformOrigin: this.getPublicUrl(),
			platformName: 'Slyng',
			delegatePublicKeyMultibase: params.delegatePublicKeyMultibase,
			aegisDelegate: params.aegisDelegate,
			signatureMultibase: params.signatureMultibase,
			canonicalDelegation: params.canonicalDelegation,
			createdAt: now
		});

		const sessionId = await this.createLocalSession(
			did,
			delegation.delegatePublicKey,
			delegation.delegatedKeyId
		);
		const bridge = this.authService.issueBridgeToken(sessionId);
		this.logger.log(
			`Self-custody sign-in: ${did.slice(0, 24)}… (${existingIdentity ? 'returning' : 'new'})`
		);
		return { did, sessionId, bridge };
	}

	/**
	 * Provision an account from an IMPORTED Aegis seed (register-with-import).
	 * Unlike register(), the keypair is not generated — the encrypted seed +
	 * DID come from the export bundle. The caller has already verified the
	 * password decrypts the seed and that it binds to `did`. We recreate the
	 * identity with the same Aegis columns (so the same password logs in),
	 * root-sign a fresh self-delegation, and mint a session. The DID is
	 * preserved end-to-end — this is an identity migration, not a new user.
	 */
	async provisionImportedAccount(params: {
		username: string;
		password: string;
		did: string;
		publicKey: string;
		aegisBundle: AegisBundle;
		displayName?: string;
		inviteCode?: string;
	}): Promise<{ did: string; sessionId: string; bridge: string }> {
		const { username, password, did, publicKey, aegisBundle } = params;

		const mode = await this.getRegistrationMode();
		if (mode === 'closed') throw new HttpException('Registration is closed', 403);
		if (await this.accounts.usernameExists(username)) {
			throw new HttpException('Username already exists', 409);
		}
		if (await this.identities.findByDid(did)) {
			throw new HttpException('This identity already exists on this instance', 409);
		}

		let inviteRedeemed: string | null = null;
		if (mode === 'invite_only') inviteRedeemed = await this.redeemInvite(params.inviteCode);

		const now = new Date();
		const password_hash = await this.crypto.hashPassword(password);
		const account = await this.accounts.create({
			username,
			password_hash,
			role: 'USER',
			created_at: now,
			updated_at: now
		});

		try {
			await this.identities.createIdentityAegis({
				did,
				publicKey,
				aegisBundle,
				accountId: account.id,
				now
			});
			await this.accounts.merge(account.id, { did, updated_at: now });

			const identity = await this.identities.findByDid(did);
			if (!identity) throw new Error('identity vanished after create');
			const delegation = await this.platform.createPlatformDelegation({
				did,
				platformOrigin: this.getPublicUrl(),
				platformName: 'Slyng',
				rootSignFn: this.platform.createAegisRootSignFn(identity, password)
			});

			await this.profiles.create({
				account_id: account.id,
				display_name: params.displayName,
				identity_host_url: this.getPublicUrl(),
				created_at: now,
				updated_at: now
			});

			const sessionId = await this.createLocalSession(
				did,
				delegation.delegatePublicKey,
				delegation.delegatedKeyId
			);
			const bridge = this.authService.issueBridgeToken(sessionId);
			this.logger.log(`Imported account provisioned: ${username} (${did.slice(0, 24)}…)`);
			return { did, sessionId, bridge };
		} catch (err) {
			await this.identities.deleteByDid(did).catch(() => {});
			await this.delegatedKeys.deleteByDid(did).catch(() => {});
			await this.profiles.deleteByAccountId(account.id).catch(() => {});
			await this.accounts.delete(account.id).catch(() => {});
			if (inviteRedeemed) {
				await this.kv
					.atomicIncrementField(INVITE_CODE_TYPE, inviteRedeemed, 'uses', -1, 0)
					.catch(() => {});
			}
			this.logger.error(`Imported-account provisioning failed for ${username}: ${err}`);
			if (err instanceof HttpException) throw err;
			throw new HttpException('Failed to provision imported account', 500);
		}
	}

	/** Atomically redeem an invite code; throws on invalid/exhausted. Returns
	 * the code so callers can restore the use on a later failure. */
	private async redeemInvite(code: string | undefined): Promise<string> {
		if (!code) throw new HttpException('Invite code required', 403);
		const entry = await this.kv.getEntry(INVITE_CODE_TYPE, code);
		if (!entry) throw new HttpException('Invalid invite code', 403);
		const value = entry.value as InviteCodeValue;
		if (value.max_uses !== null && value.uses >= value.max_uses) {
			throw new HttpException('Invite code exhausted', 403);
		}
		try {
			await this.kv.atomicIncrementField(
				INVITE_CODE_TYPE,
				code,
				'uses',
				1,
				0,
				value.max_uses ?? undefined
			);
		} catch (err) {
			if (err instanceof Error && err.message === 'QUOTA_EXCEEDED') {
				throw new HttpException('Invite code exhausted', 403);
			}
			throw err;
		}
		return code;
	}

	/** `syner_<did-suffix-8>_<rand4>`, retried until unique. */
	private async deriveUniqueSelfCustodyUsername(did: string): Promise<string> {
		const suffix = did.replace(/^did:syr:/, '').slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '');
		for (let attempt = 0; attempt < 8; attempt++) {
			const rand = randomBytes(3).toString('hex').slice(0, 4);
			const username = `syner_${suffix}_${rand}`;
			if (!(await this.accounts.usernameExists(username))) return username;
		}
		throw new HttpException('Could not allocate a username', 500);
	}

	/**
	 * Local sessions reuse the platform_session table + AuthService flow —
	 * the "platform token" is self-issued (sessionId `platform:<dkId>`),
	 * making it valid against our own /api/platform endpoints, exactly as a
	 * remote syr token would be.
	 */
	private async createLocalSession(
		did: string,
		delegatePublicKey: string,
		delegatedKeyId: string
	): Promise<string> {
		const accessToken = this.jwt.generateAccessToken(
			{ userId: did, sessionId: `platform:${delegatedKeyId}` },
			'30d'
		);
		const publicUrl = this.getPublicUrl();
		await this.authService.upsertUser({ did, delegate_public_key: delegatePublicKey }, publicUrl);
		return this.authService.createSession(
			{
				did,
				access_token: accessToken,
				delegate_public_key: delegatePublicKey,
				expires_in: LOCAL_SESSION_TTL_SECONDS
			},
			publicUrl
		);
	}
}
