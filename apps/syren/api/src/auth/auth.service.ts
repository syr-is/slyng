import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DbService } from '../db/db.service';
import { RecordId } from 'surrealdb';
import { UserRepository, PlatformSessionRepository } from './user.repository';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_REPLAY_TTL_MS = 11 * 60 * 1000; // slightly larger than TTL

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		private readonly db: DbService,
		private readonly config: ConfigService,
		private readonly users: UserRepository,
		private readonly sessions: PlatformSessionRepository
	) {}

	getPlatformOrigin(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174');
	}

	getCallbackUrl(): string {
		return `${this.getPlatformOrigin()}/api/auth/callback`;
	}

	isProduction(): boolean {
		return this.config.get('NODE_ENV', 'development') === 'production';
	}

	// In-memory single-use guard for OAuth state tokens. Cleared periodically.
	private readonly seenStates = new Map<string, number>();

	private getStateSecret(): string {
		// SYREN_STATE_SECRET is the stable HMAC key. Fall back to the
		// session secret or a process-lifetime random — the fallback breaks
		// state validation across restarts but keeps dev usable.
		let secret = this.config.get<string>('SYREN_STATE_SECRET');
		if (secret) return secret;
		secret = this.config.get<string>('SYREN_SESSION_SECRET');
		if (secret) return secret;
		if (!this._fallbackSecret) {
			this._fallbackSecret = randomBytes(32).toString('hex');
			this.logger.warn(
				'No SYREN_STATE_SECRET / SYREN_SESSION_SECRET set; using a process-lifetime fallback. OAuth state validation will reset on every restart.'
			);
		}
		return this._fallbackSecret;
	}
	private _fallbackSecret?: string;

	/**
	 * Issue a self-contained OAuth state token.
	 * Format: `<random>.<timestamp>.<hmac>` (each part base64url).
	 *
	 * The cookie-less variant — survives Tauri webviews and other
	 * environments where third-party Set-Cookie from fetch is dropped.
	 */
	issueOAuthState(): string {
		const random = randomBytes(24).toString('base64url');
		const ts = Date.now().toString();
		const sig = this.signState(random, ts);
		return `${random}.${ts}.${sig}`;
	}

	/**
	 * Validate a state token. Returns true on first validation; subsequent
	 * presentations of the same token within the replay window return false
	 * to prevent replay.
	 */
	verifyOAuthState(token: string): boolean {
		if (!token) return false;
		const parts = token.split('.');
		if (parts.length !== 3) return false;
		const [random, ts, sig] = parts;
		const expected = this.signState(random, ts);
		const a = Buffer.from(sig, 'base64url');
		const b = Buffer.from(expected, 'base64url');
		if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
		const issued = Number(ts);
		if (!Number.isFinite(issued) || Date.now() - issued > STATE_TTL_MS) return false;

		// Single-use enforcement.
		this.cleanSeenStates();
		if (this.seenStates.has(token)) return false;
		this.seenStates.set(token, Date.now());
		return true;
	}

	private signState(random: string, ts: string): string {
		return createHmac('sha256', this.getStateSecret())
			.update(`${random}.${ts}`)
			.digest('base64url');
	}

	private cleanSeenStates(): void {
		const cutoff = Date.now() - STATE_REPLAY_TTL_MS;
		for (const [k, v] of this.seenStates) {
			if (v < cutoff) this.seenStates.delete(k);
		}
	}

	async fetchInstanceManifest(instanceUrl: string) {
		const base = instanceUrl.replace(/\/+$/, '');
		const response = await fetch(`${base}/.well-known/syr`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(5000)
		});
		if (!response.ok) return null;
		return response.json() as Promise<{
			platform?: {
				consent: string;
				token: string;
				sign: string;
				challenge: string;
				delegations: string;
				revoke: string;
			};
			[key: string]: unknown;
		}>;
	}

	async getConsentUrl(
		instanceUrl: string,
		params: { platform_origin: string; platform_name: string; callback_url: string; scopes: string; state: string }
	): Promise<string> {
		const manifest = await this.fetchInstanceManifest(instanceUrl);
		if (!manifest?.platform) throw new Error('Instance does not support platform delegation');

		const url = new URL(manifest.platform.consent);
		url.searchParams.set('platform_origin', params.platform_origin);
		url.searchParams.set('platform_name', params.platform_name);
		url.searchParams.set('callback_url', params.callback_url);
		url.searchParams.set('scopes', params.scopes);
		url.searchParams.set('state', params.state);
		return url.toString();
	}

	async exchangePlatformCode(
		instanceUrl: string,
		code: string,
		delegationId: string,
		callbackUrl: string,
		platformOrigin: string
	) {
		const manifest = await this.fetchInstanceManifest(instanceUrl);
		if (!manifest?.platform) throw new Error('Instance does not support platform delegation');

		this.logger.debug(`Exchanging code at ${manifest.platform.token}`);

		const response = await fetch(manifest.platform.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code,
				delegation_id: delegationId,
				callback_url: callbackUrl,
				platform_origin: platformOrigin
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			const msg = `Token exchange failed: ${response.status} ${(error as any).error_description || ''}`;
			this.logger.error(msg);
			throw new Error(msg);
		}

		return response.json() as Promise<{
			access_token: string;
			token_type: string;
			expires_in: number;
			did: string;
			delegate_public_key: string;
			scopes: string[];
		}>;
	}

	/**
	 * Record identity-only mapping. Profile data (username, avatar, bio) is NOT
	 * stored — clients resolve profiles directly from the user's syr instance.
	 */
	async upsertUser(
		tokens: { did: string; delegate_public_key: string },
		syrInstanceUrl: string
	) {
		const surreal = this.db.getDb();
		await surreal.query(
			`UPSERT user SET
				did = $did,
				syr_instance_url = $syr_instance_url,
				delegate_public_key = $delegate_public_key,
				is_online = true,
				last_seen_at = time::now(),
				updated_at = time::now()
			WHERE did = $did`,
			{
				did: tokens.did,
				syr_instance_url: syrInstanceUrl,
				delegate_public_key: tokens.delegate_public_key
			}
		);
		this.logger.log(`Identity recorded: ${tokens.did.slice(0, 20)}...`);
	}

	async createSession(
		tokens: { did: string; access_token: string; delegate_public_key: string; expires_in: number },
		syrInstanceUrl: string
	): Promise<string> {
		const surreal = this.db.getDb();
		const sessionId = crypto.randomUUID();
		const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

		await surreal.query(
			`CREATE platform_session SET
				id = $session_id,
				user_id = $did,
				platform_token = $platform_token,
				delegate_public_key = $delegate_public_key,
				did = $did,
				token_expires_at = $token_expires_at,
				syr_instance_url = $syr_instance_url,
				created_at = time::now(),
				updated_at = time::now()`,
			{
				session_id: sessionId,
				did: tokens.did,
				platform_token: tokens.access_token,
				delegate_public_key: tokens.delegate_public_key,
				token_expires_at: tokenExpiresAt.toISOString(),
				syr_instance_url: syrInstanceUrl
			}
		);

		this.logger.log(`Session created: ${sessionId.slice(0, 8)}...`);
		return sessionId;
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.sessions.delete(new RecordId('platform_session', sessionId));
		this.logger.log(`Session deleted: ${sessionId.slice(0, 8)}...`);
	}

	async getSession(sessionId: string) {
		return this.sessions.findById(new RecordId('platform_session', sessionId)) as Promise<{
			user_id: string;
			did: string;
			delegate_public_key: string;
			platform_token: string;
			token_expires_at: string;
			syr_instance_url: string;
		} | null>;
	}

	async getUserByDid(did: string): Promise<Record<string, unknown> | null> {
		return this.users.findOne({ did });
	}
}
