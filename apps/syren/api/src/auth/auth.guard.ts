import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
	private readonly logger = new Logger(AuthGuard.name);

	constructor(
		private readonly authService: AuthService,
		private readonly reflector: Reflector
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass()
		]);
		if (isPublic) return true;

		const request = context.switchToHttp().getRequest<Request>();

		// Accept the session via either the syren_session cookie (web) or
		// `Authorization: Bearer <session>` (native / WASM client). Same
		// session row in the DB; same trust level.
		const cookieSession = request.cookies?.syren_session as string | undefined;
		const auth = request.headers['authorization'];
		const bearerSession =
			typeof auth === 'string' && /^Bearer\s+/i.test(auth)
				? auth.replace(/^Bearer\s+/i, '').trim()
				: undefined;
		const sessionId = cookieSession || bearerSession;

		if (!sessionId) return false;

		try {
			const session = await this.authService.getSession(sessionId);
			if (!session) return false;

			const tokenExpiry = new Date(session.token_expires_at);
			if (tokenExpiry < new Date()) return false;

			(request as any).user = {
				id: session.did,
				did: session.did,
				delegate_public_key: session.delegate_public_key,
				platform_token: session.platform_token,
				syr_instance_url: session.syr_instance_url
			};

			return true;
		} catch (err) {
			this.logger.debug(`Auth failed: ${err instanceof Error ? err.message : err}`);
			return false;
		}
	}
}
