import { Controller, Get, Post, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VoiceService } from './voice.service';
import { LiveKitService } from './livekit.service';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { VoiceTokenDto } from '../dto';

@ApiTags('voice')
@Controller()
export class VoiceController {
	constructor(
		private readonly voiceService: VoiceService,
		private readonly livekit: LiveKitService
	) {}

	@Get('servers/:serverId/voice-states')
	@ApiOperation({ summary: 'Voice state snapshot for a server' })
	async serverVoiceStates(@Param('serverId') serverId: string, @Req() req: any) {
		if (!req.user?.id) throw new HttpException('Unauthorized', 401);
		return this.voiceService.getByServer(serverId);
	}

	@Post('voice/token')
	@SkipServerAccess()
	@ApiOperation({ summary: 'Get a LiveKit room token for a voice channel' })
	async getToken(@Body() body: VoiceTokenDto, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);

		const roomName = this.livekit.roomNameForChannel(body.channel_id);
		const metadata = JSON.stringify({ did: userId });
		const token = await this.livekit.generateToken(userId, roomName, metadata);

		return {
			token,
			url: this.livekit.getUrl()
		};
	}
}
