import { Global, Module } from '@nestjs/common';
import { OverrideController } from './override.controller';
import { OverrideService } from './override.service';

@Global()
@Module({
	controllers: [OverrideController],
	providers: [OverrideService],
	exports: [OverrideService]
})
export class OverrideModule {}
