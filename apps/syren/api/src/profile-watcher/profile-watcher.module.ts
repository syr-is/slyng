import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProfileWatcherService } from './profile-watcher.service';

@Global()
@Module({
	imports: [ScheduleModule.forRoot()],
	providers: [ProfileWatcherService],
	exports: [ProfileWatcherService]
})
export class ProfileWatcherModule {}
