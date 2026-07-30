import { Global, Module } from '@nestjs/common';
import { ObjectStoreService } from './object-store.service';

/**
 * Global S3 object store. Exported so any module (chat uploads, IdP content)
 * can inject `ObjectStoreService` without importing this module explicitly.
 */
@Global()
@Module({
	providers: [ObjectStoreService],
	exports: [ObjectStoreService]
})
export class StorageModule {}
