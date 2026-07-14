import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';

export interface IdpJwtPayload {
	userId: string;
	sessionId: string;
}

/**
 * HS256 JWTs in syr's exact format (issuer `syr`, audience `syr-api`,
 * payload `{ userId, sessionId }`) — port of generateAccessToken /
 * verifyAccessToken from syr's server/auth.ts. Platform access tokens
 * carry sessionId `platform:<delegated_key id>`.
 */
@Injectable()
export class IdpJwtService {
	private readonly logger = new Logger(IdpJwtService.name);

	constructor(private readonly config: ConfigService) {}

	private _fallbackSecret?: string;

	private getSecret(): string {
		const secret =
			this.config.get<string>('SYREN_JWT_SECRET') ??
			this.config.get<string>('SYREN_SESSION_SECRET');
		if (secret) return secret;
		if (this.config.get('NODE_ENV', 'development') === 'production') {
			throw new Error('SYREN_JWT_SECRET must be set in production');
		}
		if (!this._fallbackSecret) {
			this._fallbackSecret = randomBytes(32).toString('hex');
			this.logger.warn(
				'No SYREN_JWT_SECRET set; using a process-lifetime fallback. Issued tokens will not survive a restart.'
			);
		}
		return this._fallbackSecret;
	}

	generateAccessToken(payload: IdpJwtPayload, expiresIn = '24h'): string {
		return jwt.sign(payload, this.getSecret(), {
			expiresIn,
			issuer: 'syr',
			audience: 'syr-api'
		} as SignOptions);
	}

	verifyAccessToken(token: string): IdpJwtPayload | null {
		try {
			return jwt.verify(token, this.getSecret(), {
				issuer: 'syr',
				audience: 'syr-api'
			}) as IdpJwtPayload;
		} catch {
			return null;
		}
	}
}
