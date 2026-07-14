import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { KlipyProvider } from './klipy.provider';

/**
 * Klipy media-picker proxy (P5). Ported from pendi's ClipsModule. The provider
 * uses native `fetch` (no HttpModule); ConfigService is available globally.
 * `ClipsService` is exported so later phases (e.g. saving a picked clip to the
 * P7 library) can reuse `isAllowedMediaUrl`.
 */
@Module({
	controllers: [ClipsController],
	providers: [ClipsService, KlipyProvider],
	exports: [ClipsService]
})
export class ClipsModule {}
