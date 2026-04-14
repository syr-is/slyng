import { Module } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { VoiceStateRepository } from './voice.repository';
import { ChannelRepository } from '../channel/channel.repository';

@Module({
	controllers: [VoiceController],
	providers: [VoiceService, VoiceStateRepository, ChannelRepository],
	exports: [VoiceService]
})
export class VoiceModule {}
