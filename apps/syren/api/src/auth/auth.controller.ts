import { Controller, Get, Post, Body, Query, Req, Res, HttpException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import type { Request, Response } from 'express';

const SESSION_COOKIE = 'syren_session';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
	private readonly logger = new Logger(AuthController.name);
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Post('login')
	@ApiOperation({ summary: 'Initiate syr instance login — returns consent redirect URL' })
	async login(
		@Body() body: { instance_url: string; redirect?: string },
		@Res({ passthrough: true }) res: Response
	) {
		let instanceUrl = body.instance_url?.trim();
		if (!instanceUrl) throw new HttpException('Instance URL is required', 400);

		if (!instanceUrl.startsWith('http://') && !instanceUrl.startsWith('https://')) {
			instanceUrl = `https://${instanceUrl}`;
		}
		instanceUrl = instanceUrl.replace(/\/+$/, '');

		const manifest = await this.authService.fetchInstanceManifest(instanceUrl).catch(() => null);
		if (!manifest) throw new HttpException('Could not reach this instance', 400);
		if (!manifest.platform) throw new HttpException('Instance does not support platform delegation', 400);

		const state = crypto.randomUUID();

		// Set cookies for callback
		const cookieOpts = {
			path: '/',
			httpOnly: true,
			secure: this.authService.isProduction(),
			sameSite: 'none' as const,
			maxAge: 600 * 1000
		};
		res.cookie('syren_pending_instance', instanceUrl, cookieOpts);
		res.cookie('syren_oauth_state', state, cookieOpts);
		if (body.redirect && typeof body.redirect === 'string' && body.redirect.startsWith('/')) {
			res.cookie('syren_post_login_redirect', body.redirect, cookieOpts);
		}

		const consentUrl = await this.authService.getConsentUrl(instanceUrl, {
			platform_origin: this.authService.getPlatformOrigin(),
			platform_name: 'Syren',
			callback_url: this.authService.getCallbackUrl(),
			scopes: 'identity:read,profile:read',
			state
		});

		return { consent_url: consentUrl };
	}

	@Public()
	@Get('callback')
	@ApiOperation({ summary: 'OAuth callback — exchanges code for session' })
	async callback(
		@Query('code') code: string,
		@Query('state') state: string,
		@Query('delegation_id') delegationId: string,
		@Query('error') errorParam: string,
		@Query('error_description') errorDesc: string,
		@Req() req: Request,
		@Res() res: Response
	) {
		this.logger.debug(`Callback: code=${code?.slice(0, 8)} state=${state?.slice(0, 8)} delegation_id=${delegationId?.slice(0, 8)}`);
		this.logger.debug(`Cookies present: ${Object.keys(req.cookies || {}).join(', ')}`);

		if (errorParam) {
			return res.redirect(`/login?error=${encodeURIComponent(errorDesc || errorParam)}`);
		}

		if (!code) return res.redirect('/login?error=missing_code');

		const storedState = req.cookies?.syren_oauth_state;
		this.logger.debug(`State check: stored=${storedState?.slice(0, 8)} vs received=${state?.slice(0, 8)}`);
		if (!state || state !== storedState) {
			this.logger.warn('State mismatch — possible CSRF or missing cookie');
			return res.redirect('/login?error=invalid_state');
		}
		res.clearCookie('syren_oauth_state', { path: '/' });

		const syrInstanceUrl = req.cookies?.syren_pending_instance;
		if (!syrInstanceUrl) {
			return res.redirect('/login?error=session_expired');
		}

		if (!delegationId) {
			return res.redirect('/login?error=missing_delegation_id');
		}

		try {
			const platformOrigin = this.authService.getPlatformOrigin();
			const callbackUrl = this.authService.getCallbackUrl();

			const tokens = await this.authService.exchangePlatformCode(
				syrInstanceUrl, code, delegationId, callbackUrl, platformOrigin
			);

			await this.authService.upsertUser(tokens, syrInstanceUrl);

			const sessionId = await this.authService.createSession(tokens, syrInstanceUrl);

			res.clearCookie('syren_pending_instance', { path: '/' });
			const postLoginRedirect = req.cookies?.syren_post_login_redirect;
			if (postLoginRedirect) res.clearCookie('syren_post_login_redirect', { path: '/' });
			res.cookie(SESSION_COOKIE, sessionId, {
				path: '/',
				httpOnly: true,
				secure: this.authService.isProduction(),
				sameSite: 'lax',
				maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
			});

			const target = postLoginRedirect && postLoginRedirect.startsWith('/') ? postLoginRedirect : '/channels/@me';
			return res.redirect(target);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Auth failed';
			return res.redirect(`/login?error=${encodeURIComponent(msg)}`);
		}
	}

	@Public()
	@Post('logout')
	@ApiOperation({ summary: 'Logout — clears session' })
	async logout(@Req() req: Request, @Res() res: Response) {
		const sessionId = req.cookies?.[SESSION_COOKIE];
		if (sessionId) {
			try {
				await this.authService.deleteSession(sessionId);
			} catch { /* best effort */ }
		}
		res.clearCookie(SESSION_COOKIE, { path: '/' });
		return res.redirect('/login');
	}

	@Public()
	@Get('me')
	@ApiOperation({ summary: 'Get session identity (DID + instance). Profiles resolved client-side.' })
	async me(@Req() req: Request) {
		const sessionId = req.cookies?.[SESSION_COOKIE];
		if (!sessionId) throw new HttpException('Not authenticated', 401);

		const session = await this.authService.getSession(sessionId);
		if (!session) throw new HttpException('Session expired', 401);

		const tokenExpiry = new Date(session.token_expires_at);
		if (tokenExpiry < new Date()) throw new HttpException('Session expired', 401);

		return {
			did: session.did,
			syr_instance_url: session.syr_instance_url,
			delegate_public_key: session.delegate_public_key
		};
	}
}
