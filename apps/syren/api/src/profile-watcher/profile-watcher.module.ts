import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProfileWatcherService } from './profile-watcher.service';
import { IdpModule } from '../idp/idp.module';

@Global()
@Module({
	imports: [ScheduleModule.forRoot(), IdpModule],
	providers: [ProfileWatcherService],
	exports: [ProfileWatcherService]
})
export class ProfileWatcherModule {}
