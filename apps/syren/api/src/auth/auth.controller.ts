import { Controller, Get, Post, Body, Query, Req, Res, HttpException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import type { Request, Response } from 'express';

const SESSION_COOKIE = 'syren_session';

/**
 * A redirect target is allowed when it is one of:
 *  - a same-origin path on the API host (the legacy web flow);
 *  - the bundled Tauri shell origins, for in-app SPA navigation;
 *  - `syren://auth/callback` — the mobile native app's deep-link
 *    redirect (handled by `tauri-plugin-deep-link`); or
 *  - `http://localhost:<port>/` — the desktop native app's loopback
 *    redirect (handled by `tauri-plugin-oauth`, which binds a random
 *    port for each handshake).
 *
 * Any other shape (arbitrary external https, javascript:, etc.) is
 * rejected — this stops the field from being a generic open redirect.
 */
function isAllowedRedirect(value: unknown): value is string {
	if (typeof value !== 'string' || !value) return false;
	if (value.startsWith('/')) return true;
	if (/^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)\/[^\s]*$/.test(value)) return true;
	if (/^syren:\/\/auth\/callback(?:\?[^\s]*)?$/.test(value)) return true;
	// Loopback for tauri-plugin-oauth on desktop. Port is dynamic; we
	// only accept the exact `http://localhost:<port>/` shape (no path,
	// optional trailing query).
	return /^http:\/\/localhost:\d{2,5}\/?(?:\?[^\s]*)?$/.test(value);
}

function isCustomSchemeRedirect(target: string): boolean {
	return !target.startsWith('/') && !target.startsWith('http');
}

/**
 * Read the active session id from either the `syren_session` cookie
 * (web) or `Authorization: Bearer <id>` header (native / WASM client).
 */
function readSessionId(req: Request): string | undefined {
	const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
	if (cookie) return cookie;
	const auth = req.headers['authorization'];
	if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
		return auth.replace(/^Bearer\s+/i, '').trim() || undefined;
	}
	return undefined;
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

		// Self-contained, HMAC-signed state token. Carries the instance
		// URL and the post-login redirect target inside the signed
		// payload, so the callback URL itself stays static — no query
		// params on it whatsoever. This is what keeps syr's token
		// endpoint happy: it does a byte-level callback_url match
		// between consent and token-exchange.
		const state = this.authService.issueOAuthState({
			inst: instanceUrl,
			redirect: isAllowedRedirect(body.redirect) ? body.redirect : undefined
		});

		const callbackUrl = this.authService.getCallbackUrl();

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
		const verified = state ? this.authService.verifyOAuthState(state) : null;
		if (!verified) {
			this.logger.warn('OAuth state failed HMAC verification or replayed');
			return res.redirect('/login?error=invalid_state');
		}

		// Recover the syr instance URL and post-login redirect from the
		// signed state payload — they were sealed in there during /login,
		// so no cookies / query-params on the callback URL are required.
		const syrInstanceUrl = verified.inst;
		const postLoginRedirect = isAllowedRedirect(verified.redirect)
			? verified.redirect
			: undefined;

		if (!delegationId) {
			return res.redirect('/login?error=missing_delegation_id');
		}

		try {
			const platformOrigin = this.authService.getPlatformOrigin();

			// `callback_url` MUST be byte-identical to what we sent during
			// the consent step — syr.is verifies it on the token endpoint.
			// Keeping it static (no query params) eliminates URL-encoding
			// drift between consent and exchange.
			const callbackUrl = this.authService.getCallbackUrl();

			const tokens = await this.authService.exchangePlatformCode(
				syrInstanceUrl, code, delegationId, callbackUrl, platformOrigin
			);

			await this.authService.upsertUser(tokens, syrInstanceUrl);

			const sessionId = await this.authService.createSession(tokens, syrInstanceUrl);
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

			let target = isAllowedRedirect(postLoginRedirect) ? postLoginRedirect : '/channels/@me';

			// For non-HTTP redirect targets (the native app's deep link
			// or loopback) the session cookie is useless — cookies are
			// scoped to web origins. Issue a one-shot bridge token
			// instead, attach it as `?code=…`, and let the native client
			// swap it for the real session id via /auth/exchange.
			if (isCustomSchemeRedirect(target) || target.startsWith('http://localhost:')) {
				const bridge = this.authService.issueBridgeToken(sessionId);
				const sep = target.includes('?') ? '&' : '?';
				target = `${target}${sep}code=${encodeURIComponent(bridge)}`;
			}

			// Same-origin path → normal 302 (legacy web flow).
			if (target.startsWith('/')) {
				return res.redirect(target);
			}

			// Desktop loopback (tauri-plugin-oauth listens on
			// http://localhost:<port>/). A regular 302 is fine — the
			// browser hits the loopback, plugin-oauth captures the URL
			// (with `?code=…`), and emits a default success page. No
			// custom HTML needed here.
			if (target.startsWith('http://localhost:')) {
				return res.redirect(target);
			}

			// Mobile custom scheme (`syren://auth/callback?code=…`).
			// Chrome on Android refuses to follow cross-scheme JS-driven
			// navigations from the page (no user gesture), and even
			// Location: redirects can be blocked. The robust pattern
			// every production mobile-OAuth flow uses:
			//   1. Try `intent://` syntax with a fallback URL — Chrome
			//      may honour it, and gives us a graceful fallback if
			//      not.
			//   2. Show a visible "Continue in App" button so the user
			//      can complete it with a single tap if auto-launch
			//      doesn't fire.
			//   3. Auto-launch attempts (meta refresh + scripted click)
			//      as best-effort; iOS Safari and most non-Chromium
			//      browsers honour them.
			const codeParam = (() => {
				try {
					return new URL(target).searchParams.get('code') ?? '';
				} catch {
					return '';
				}
			})();
			const fallbackUrl = `${this.authService.getPlatformOrigin()}/login`;
			const intentUrl =
				`intent://auth/callback?code=${encodeURIComponent(codeParam)}` +
				`#Intent;scheme=syren;package=is.syr.syren;` +
				`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
			const directUrl = target;
			const escapedDirect = JSON.stringify(directUrl);
			const escapedIntent = JSON.stringify(intentUrl);
			res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${directUrl.replace(/"/g, '&quot;')}">
<title>Sign-in successful</title>
<style>
html,body{margin:0;min-height:100vh;background:#0a0a0b;color:#fafafa;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center}
.card{max-width:360px;padding:32px 24px;text-align:center}
h1{font-size:20px;margin:0 0 8px;font-weight:600}
p{margin:0 0 16px;font-size:14px;color:#a1a1aa;line-height:1.5}
.btn{display:inline-block;padding:14px 24px;border-radius:9999px;background:#fafafa;color:#0a0a0b;font-weight:600;text-decoration:none;font-size:15px;margin-top:12px}
.btn:active{opacity:.8}
.muted{margin-top:24px;font-size:12px;color:#71717a}
</style>
</head>
<body>
<div class="card">
<h1>Sign-in successful</h1>
<p>You'll be returned to the app. If nothing happens, tap the button below.</p>
<a id="open" class="btn" href=${escapedDirect}>Open Syren</a>
<p class="muted">You can close this tab once the app opens.</p>
</div>
<script>
(function () {
  var direct = ${escapedDirect};
  var intent = ${escapedIntent};
  var link = document.getElementById('open');
  if (/Android/i.test(navigator.userAgent)) {
    link.href = intent;
  }
  // Best-effort auto-launch. Chrome on Android typically blocks this
  // without a user gesture, but iOS Safari and many other browsers
  // honour it. The visible button is the guaranteed path.
  setTimeout(function () { try { link.click(); } catch (_) {} }, 50);
  setTimeout(function () { try { window.location.href = link.href; } catch (_) {} }, 250);
})();
</script>
</body>
</html>`);
			return;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Auth failed';
			return res.redirect(`/login?error=${encodeURIComponent(msg)}`);
		}
	}

	@Public()
	@Post('logout')
	@ApiOperation({ summary: 'Logout — clears session' })
	async logout(@Req() req: Request, @Res() res: Response) {
		const sessionId = readSessionId(req);
		if (sessionId) {
			try {
				await this.authService.deleteSession(sessionId);
			} catch { /* best effort */ }
		}
		res.clearCookie(SESSION_COOKIE, { path: '/' });
		// Native client (Bearer auth) sends fetch(); web sends top-level
		// nav. Return JSON for both — the redirect was for the legacy
		// web flow only.
		res.status(200).json({ success: true });
	}

	/**
	 * Swap a one-shot bridge code (issued during the OAuth callback for
	 * custom-scheme redirects) for the long-lived session id. Used by
	 * the native client.
	 */
	@Public()
	@Post('exchange')
	@ApiOperation({ summary: 'Exchange a one-shot bridge code for a session id' })
	async exchange(@Body() body: { code: string }) {
		if (!body?.code) throw new HttpException('Missing code', 400);
		const sessionId = this.authService.consumeBridgeToken(body.code);
		if (!sessionId) throw new HttpException('Invalid or expired bridge code', 400);
		return { session: sessionId };
	}

	@Public()
	@Get('me')
	@ApiOperation({ summary: 'Get session identity (DID + instance). Profiles resolved client-side.' })
	async me(@Req() req: Request) {
		const sessionId = readSessionId(req);
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
