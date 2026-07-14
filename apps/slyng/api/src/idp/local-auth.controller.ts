import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AuthService } from '../auth/auth.service';
import { AccountService } from './account.service';
import { LocalLoginDto, LocalRegisterDto } from '../dto';

const SESSION_COOKIE = 'slyng_session';

/**
 * Local-account auth: register / login against THIS instance instead of a
 * remote syr. Responses carry a one-shot bridge token — the client trades
 * it at POST /auth/exchange exactly like the OAuth callback flow, so the
 * WASM client's session store works identically for both login paths. The
 * session cookie is also set directly for the same-origin web app.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class LocalAuthController {
	constructor(
		private readonly accountService: AccountService,
		private readonly authService: AuthService
	) {}

	private setSessionCookie(res: Response, sessionId: string): void {
		// Same options as the OAuth callback (auth.controller.ts) — secure
		// is tied to prod because sameSite=none requires it.
		res.cookie(SESSION_COOKIE, sessionId, {
			path: '/',
			httpOnly: true,
			secure: this.authService.isProduction(),
			sameSite: 'none',
			maxAge: 30 * 24 * 60 * 60 * 1000
		});
	}

	@Public()
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post('register')
	@ApiOperation({ summary: 'Register a local account (slyng as syr instance)' })
	async register(@Body() body: LocalRegisterDto, @Res({ passthrough: true }) res: Response) {
		const { did, sessionId, bridge } = await this.accountService.register(body);
		this.setSessionCookie(res, sessionId);
		return { bridge, did };
	}

	@Public()
	@Throttle({ default: { limit: 10, ttl: 60_000 } })
	@Post('local/login')
	@ApiOperation({ summary: 'Login with a local account username/password' })
	async login(@Body() body: LocalLoginDto, @Res({ passthrough: true }) res: Response) {
		const { did, sessionId, bridge } = await this.accountService.login(
			body.username,
			body.password
		);
		this.setSessionCookie(res, sessionId);
		return { bridge, did };
	}

	@Public()
	@Get('registration-info')
	@ApiOperation({ summary: 'Registration mode for the local-account signup form' })
	async registrationInfo() {
		return {
			mode: await this.accountService.getRegistrationMode(),
			local_accounts: true
		};
	}
}
