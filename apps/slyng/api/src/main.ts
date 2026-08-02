import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

/**
 * Secrets that must be real before the process serves anything.
 *
 * Compose can only assert presence — `${VAR:?}` rejects unset and empty and
 * nothing else — so `SLYNG_JWT_SECRET=x` satisfies the deploy and yields a
 * one-character HS256 signing key. Length has to be checked here.
 *
 * Failing at boot rather than at first use is the point. `PLATFORM_DELEGATE_SECRET`
 * is read only on the registration path, so a too-short value passes the deploy,
 * passes every health check, serves every other route, and surfaces as
 * `500 Registration failed` — the exact failure this validation exists to stop
 * anyone rediscovering.
 */
function assertSecrets(config: ConfigService, logger: Logger) {
	if (config.get('NODE_ENV', 'development') !== 'production') return;

	const MIN = 32;
	const problems: string[] = [];
	for (const name of ['PLATFORM_DELEGATE_SECRET', 'SLYNG_JWT_SECRET'] as const) {
		const v = config.get<string>(name)?.trim() ?? '';
		if (!v) problems.push(`${name} is not set`);
		else if (v.length < MIN) problems.push(`${name} is ${v.length} chars, needs >= ${MIN}`);
	}
	// Never log the values, only the names and lengths — these are the keys that
	// encrypt delegate keys at rest and sign every session token.
	if (problems.length) {
		logger.error(`Refusing to start: ${problems.join('; ')}. Generate with: openssl rand -hex 32`);
		throw new Error(`Invalid secret configuration: ${problems.join('; ')}`);
	}
}

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const logger = new Logger('Bootstrap');
	const config = app.get(ConfigService);
	assertSecrets(config, logger);

	// Disable ETag — API responses are dynamic, 304s with stale browser cache
	// caused servers/channels to render with stale data
	(app.getHttpAdapter().getInstance() as any).set?.('etag', false);

	app.use(cookieParser());
	app.useWebSocketAdapter(new WsAdapter(app));
	// `.well-known` discovery must live at the site root — federated syr
	// consumers resolve `{origin}/.well-known/syr[/:did]`, never under /api.
	app.setGlobalPrefix('api', {
		exclude: ['.well-known/syr', '.well-known/syr/:did', '.well-known/did/:did']
	});
	// Who may send a *credentialed* cross-origin request.
	//
	// `credentials: true` means the browser attaches `slyng_session` and, if the
	// response allows the origin, lets the calling page read the body. Reflecting
	// every origin therefore hands any site on the internet an authenticated,
	// readable API session belonging to whoever visits it — not merely CSRF,
	// which at least cannot read the response.
	//
	// The list is closed in production. It stays open in development because the
	// same box commonly serves syr and slyng on different ports and hostnames,
	// and a closed list there costs a debugging session for no security gain on
	// a machine with no real sessions.
	const isProd = config.get('NODE_ENV', 'development') === 'production';
	const extraOrigins = (config.get<string>('SLYNG_ALLOWED_ORIGINS') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const tauriOrigins = ['tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost'];
	// The SPA is same-origin with the API in prod, so it never reaches the check;
	// it is listed anyway for the split-host and dev cases, where it does.
	const publicOrigin = (() => {
		const raw = config.get<string>('PUBLIC_URL');
		if (!raw) return null;
		try {
			return new URL(raw).origin;
		} catch {
			logger.warn(`PUBLIC_URL is not a valid URL (${raw}); it will not be CORS-allowed`);
			return null;
		}
	})();
	const allowed = new Set([...tauriOrigins, ...extraOrigins, ...(publicOrigin ? [publicOrigin] : [])]);
	const denied = new Set<string>();
	app.enableCors({
		origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
			// No Origin header: same-origin navigation, curl, server-to-server.
			// Not a browser cross-origin request, so there is nothing to gate.
			if (!origin) return cb(null, true);
			if (allowed.has(origin)) return cb(null, true);
			if (!isProd) return cb(null, true);
			// `false`, not an Error: omitting the header is the correct refusal.
			// Throwing would turn a blocked page into a 500 in the API's logs.
			// Logged once per origin so a misconfigured client is visible without
			// handing an attacker a way to fill the disk.
			if (!denied.has(origin)) {
				denied.add(origin);
				logger.warn(
					`CORS: denied ${origin} — add it to SLYNG_ALLOWED_ORIGINS if this is one of yours`
				);
			}
			return cb(null, false);
		},
		credentials: true
	});
	if (isProd) {
		logger.log(`CORS allowlist: ${[...allowed].join(', ')}`);
	}

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Slyng Chat API')
		.setDescription('Discord-like real-time messaging API with syr identity integration')
		.setVersion('0.1')
		.addTag('servers')
		.addTag('channels')
		.addTag('messages')
		.addTag('invites')
		.addTag('auth')
		.build();

	const document = SwaggerModule.createDocument(app, swaggerConfig, { ignoreGlobalPrefix: false });
	const cleanedDoc = cleanupOpenApiDoc(document);

	app.use(
		'/reference',
		apiReference({
			theme: 'purple',
			content: cleanedDoc
		})
	);

	// Last line of defence, not a substitute for handling. The WS gateway
	// dispatches its handlers fire-and-forget so a frame never blocks the
	// socket's read loop, and Nest's ws adapter wraps only the synchronous
	// call — so any rejection that escapes a handler has nowhere to go, and
	// Node's default is to exit. Losing the whole API, every connected socket
	// included, is never the right answer to one bad frame.
	process.on('unhandledRejection', (reason) => {
		logger.error(
			`Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
		);
	});

	const port = config.get('SLYNG_API_PORT', 5175);
	await app.listen(port);
	logger.log(`Slyng Chat API listening on port ${port}`);
	logger.log(`API docs: http://localhost:${port}/reference`);
	logger.log(`WebSocket: ws://localhost:${port}/ws`);
}
bootstrap();
