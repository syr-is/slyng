import { Controller, Get, Param, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@Controller()
export class VoiceController {
	constructor(private readonly voiceService: VoiceService) {}

	/** Snapshot of every voice channel's connected users for a server. */
	@Get('servers/:serverId/voice-states')
	@ApiOperation({ summary: 'Voice state snapshot for a server' })
	async serverVoiceStates(@Param('serverId') serverId: string, @Req() req: any) {
		if (!req.user?.id) throw new HttpException('Unauthorized', 401);
		return this.voiceService.getByServer(serverId);
	}
}
