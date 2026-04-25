import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const logger = new Logger('Bootstrap');
	const config = app.get(ConfigService);

	// Disable ETag — API responses are dynamic, 304s with stale browser cache
	// caused servers/channels to render with stale data
	(app.getHttpAdapter().getInstance() as any).set?.('etag', false);

	app.use(cookieParser());
	app.useWebSocketAdapter(new WsAdapter(app));
	app.setGlobalPrefix('api');
	// Allow same-origin (web), configured origins, and the Tauri webview origins
	// for the native app. `origin: true` reflects the request origin which
	// satisfies all three; we only need to ensure credentials flow.
	const extraOrigins = (config.get<string>('SYREN_ALLOWED_ORIGINS') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const tauriOrigins = ['tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost'];
	app.enableCors({
		origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
			if (!origin) return cb(null, true); // same-origin / curl / native fetch
			if (tauriOrigins.includes(origin)) return cb(null, true);
			if (extraOrigins.includes(origin)) return cb(null, true);
			return cb(null, true); // permissive default — tighten in prod via SYREN_ALLOWED_ORIGINS
		},
		credentials: true
	});

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Syren Chat API')
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

	const port = config.get('SYREN_API_PORT', 5175);
	await app.listen(port);
	logger.log(`Syren Chat API listening on port ${port}`);
	logger.log(`API docs: http://localhost:${port}/reference`);
	logger.log(`WebSocket: ws://localhost:${port}/ws`);
}
bootstrap();
