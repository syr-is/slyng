import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import type { Request } from 'express';
import { IdpJwtService } from './idp-jwt.service';
import { DelegatedKeyRepository, type DelegatedKeyRow } from './idp.repository';

export interface PlatformTokenContext {
	did: string;
	delegatedKey: DelegatedKeyRow;
}

/**
 * Validates platform access tokens (Bearer JWT with sessionId
 * `platform:<delegated_key id>`) issued by our /api/platform/token —
 * the credential external platforms present to sign/challenge endpoints.
 * Revocation and expiry are checked per request, as syr does.
 *
 * Routes using this must also be @Public(): the global AuthGuard only
 * understands slyng session ids, not platform JWTs.
 */
@Injectable()
export class PlatformTokenGuard implements CanActivate {
	constructor(
		private readonly jwt: IdpJwtService,
		private readonly delegatedKeys: DelegatedKeyRepository
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request & { platform?: PlatformTokenContext }>();
		const auth = req.headers.authorization;
		if (!auth || !/^Bearer\s+/i.test(auth)) {
			throw new UnauthorizedException('Missing platform access token');
		}
		const token = auth.replace(/^Bearer\s+/i, '').trim();
		const payload = this.jwt.verifyAccessToken(token);
		if (!payload || !payload.sessionId?.startsWith('platform:')) {
			throw new UnauthorizedException('Invalid platform access token');
		}

		// sessionId carries the delegated_key record id. Accept both the
		// bare id and syr's `delegated_key:<id>` full form.
		let idPart = payload.sessionId.slice('platform:'.length);
		if (idPart.startsWith('delegated_key:')) idPart = idPart.slice('delegated_key:'.length);
		const dk = await this.delegatedKeys.findById(new RecordId('delegated_key', idPart));
		if (!dk) throw new UnauthorizedException('Delegation not found');
		if (dk.revoked_at) throw new UnauthorizedException('Delegation revoked');
		if (dk.expires_at && new Date() > new Date(dk.expires_at)) {
			throw new UnauthorizedException('Delegation expired');
		}

		req.platform = { did: dk.did, delegatedKey: dk };
		return true;
	}
}
