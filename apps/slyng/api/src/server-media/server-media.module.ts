import { Module } from '@nestjs/common';
import { ServerMediaController } from './server-media.controller';
import { ServerMediaService } from './server-media.service';
import { IdpStorageService } from '../idp/idp-storage.service';

/**
 * Server-owned emoji/sticker + GIF sets. Repositories come from the global
 * `DbModule`; `ObjectStoreService` (storage), `ChatGateway`, and
 * `AuditLogService` are all global too — this module only owns its controller +
 * service, and re-provides the thin `IdpStorageService` S3 wrapper.
 */
@Module({
	controllers: [ServerMediaController],
	providers: [ServerMediaService, IdpStorageService]
})
export class ServerMediaModule {}
