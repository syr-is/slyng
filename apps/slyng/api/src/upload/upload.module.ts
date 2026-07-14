import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { IdpModule } from '../idp/idp.module';

@Module({
	// IdpModule exports InstanceConfigService — the platform-wide per-file cap.
	imports: [IdpModule],
	controllers: [UploadController],
	providers: [UploadService],
	exports: [UploadService]
})
export class UploadModule {}
