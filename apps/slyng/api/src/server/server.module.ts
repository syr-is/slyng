import { Module } from '@nestjs/common';
import { ServerController, InviteController } from './server.controller';
import { ServerService } from './server.service';

@Module({
	controllers: [ServerController, InviteController],
	providers: [ServerService],
	exports: [ServerService]
})
export class ServerModule {}
