import { Controller, Get, Post, Body, Query, Req, Res, HttpException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import type { Request, Response } from 'express';

const SESSION_COOKIE = 'syren_session';

/**
 * A redirect target is allowed when it is either:
 *  - a same-origin path on the API host (legacy web behavior), or
 *  - an absolute URL under one of the bundled Tauri shell origins, so the
 *    native app can round-trip back to itself after OAuth instead of
 *    landing on the deployed web app. Tauri uses different schemes per
 *    platform: `tauri://localhost` on macOS/iOS,
 *    `http://tauri.localhost` (or https) on Android/Windows/Linux.
 *
 * Any other shape (full https URL, javascript:, etc.) is rejected — this
 * stops the field from being a generic open redirect.
 */
function isAllowedRedirect(value: unknown): value is string {
	if (typeof value !== 'string' || !value) return false;
	if (value.startsWith('/')) return true;
	return /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)\/[^\s]*$/.test(value);
}

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

		// Self-contained, HMAC-signed state token — no cookie required. This
		// keeps the OAuth start working from environments where third-party
		// Set-Cookie via fetch is dropped (Tauri webviews, ITP partitioning).
		const state = this.authService.issueOAuthState();

		// We still set a syren_pending_instance cookie as a hint, but the
		// callback can recover the instance URL from the signed-state payload
		// embedded in the redirect target if the cookie is missing.
		const cookieOpts = {
			path: '/',
			httpOnly: true,
			secure: this.authService.isProduction(),
			sameSite: 'none' as const,
			maxAge: 600 * 1000
		};
		res.cookie('syren_pending_instance', instanceUrl, cookieOpts);
		if (isAllowedRedirect(body.redirect)) {
			res.cookie('syren_post_login_redirect', body.redirect, cookieOpts);
		}

		// Embed both the instance URL AND the validated post-login redirect
		// into the callback URL itself. This rides through the syr round-trip
		// as URL params, surviving cross-site cookie loss in webviews where
		// the cookies above never make it back from third-party fetch context.
		const cbParams = new URLSearchParams({ inst: instanceUrl });
		if (isAllowedRedirect(body.redirect)) cbParams.set('redirect', body.redirect);
		const callbackUrl = `${this.authService.getCallbackUrl()}?${cbParams.toString()}`;

		const consentUrl = await this.authService.getConsentUrl(instanceUrl, {
			platform_origin: this.authService.getPlatformOrigin(),
			platform_name: 'Syren',
			callback_url: callbackUrl,
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

		// HMAC-validated state — no dependency on the cookie jar.
		if (!state || !this.authService.verifyOAuthState(state)) {
			this.logger.warn('OAuth state failed HMAC verification or replayed');
			return res.redirect('/login?error=invalid_state');
		}

		// Recover the syr instance URL: prefer the cookie, fall back to the
		// `inst` query param we wired through the callback URL on /login.
		const syrInstanceUrl =
			req.cookies?.syren_pending_instance ?? (req.query.inst as string | undefined);
		if (!syrInstanceUrl) {
			return res.redirect('/login?error=session_expired');
		}

		if (!delegationId) {
			return res.redirect('/login?error=missing_delegation_id');
		}

		try {
			const platformOrigin = this.authService.getPlatformOrigin();

			// Recover the post-login redirect from EITHER the URL query (added
			// during /login as a cookie-independent backup) or the cookie
			// (used by the original web flow). Validate either one.
			const queryRedirect = req.query.redirect as string | undefined;
			const cookieRedirect = req.cookies?.syren_post_login_redirect;
			const postLoginRedirect = isAllowedRedirect(queryRedirect)
				? queryRedirect
				: isAllowedRedirect(cookieRedirect)
					? cookieRedirect
					: undefined;

			// Match the exact redirect_uri sent during /login — the token
			// endpoint at the syr instance verifies it byte-for-byte.
			const cbParams = new URLSearchParams({ inst: syrInstanceUrl });
			if (postLoginRedirect) cbParams.set('redirect', postLoginRedirect);
			const callbackUrl = `${this.authService.getCallbackUrl()}?${cbParams.toString()}`;

			const tokens = await this.authService.exchangePlatformCode(
				syrInstanceUrl, code, delegationId, callbackUrl, platformOrigin
			);

			await this.authService.upsertUser(tokens, syrInstanceUrl);

			const sessionId = await this.authService.createSession(tokens, syrInstanceUrl);

			res.clearCookie('syren_pending_instance', { path: '/' });
			if (cookieRedirect) res.clearCookie('syren_post_login_redirect', { path: '/' });
			res.cookie(SESSION_COOKIE, sessionId, {
				path: '/',
				httpOnly: true,
				// `secure` is required when sameSite=none. In dev you'll need
				// either NODE_ENV=production or to run the API behind HTTPS;
				// otherwise the cookie is dropped silently by browsers.
				secure: this.authService.isProduction(),
				// `none` is required for cross-site flows (Tauri webview at
				// tauri://localhost calling app.example.com). Same-origin web
				// is unaffected — cookies on same-origin always send.
				sameSite: 'none',
				maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
			});

			const target = isAllowedRedirect(postLoginRedirect) ? postLoginRedirect : '/channels/@me';
			// Same-origin paths use a normal 302. Custom-scheme targets like
			// `tauri://localhost/...` can be silently blocked by Android
			// WebView / WKWebView when delivered via a cross-scheme HTTP
			// Location header — send an HTML+JS page instead so the
			// navigation is initiated from script (allowed for custom
			// schemes the host app has registered).
			if (target.startsWith('/')) {
				return res.redirect(target);
			}
			const escaped = JSON.stringify(target);
			res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${target.replace(/"/g, '&quot;')}">
<title>Signing you in…</title>
<style>html,body{margin:0;height:100%;background:#0a0a0b;color:#fafafa;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}</style>
</head><body>
<p>Signing you in…</p>
<script>window.location.replace(${escaped});</script>
</body></html>`);
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
