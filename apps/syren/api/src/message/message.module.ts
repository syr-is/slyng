import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { EmbedService } from '../embed/embed.service';

@Module({
	controllers: [MessageController],
	providers: [MessageService, EmbedService],
	exports: [MessageService]
})
export class MessageModule {}
