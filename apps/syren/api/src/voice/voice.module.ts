import { Module } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { LiveKitService } from './livekit.service';
import { VoiceController } from './voice.controller';
import { VoiceStateRepository } from './voice.repository';
import { ChannelRepository } from '../channel/channel.repository';

@Module({
	controllers: [VoiceController],
	providers: [VoiceService, LiveKitService, VoiceStateRepository, ChannelRepository],
	exports: [VoiceService, LiveKitService]
})
export class VoiceModule {}
