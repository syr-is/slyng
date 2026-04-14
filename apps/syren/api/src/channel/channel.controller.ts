import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChannelService } from './channel.service';

@ApiTags('channels')
@Controller()
export class ChannelController {
	constructor(private readonly channelService: ChannelService) {}

	@Get('servers/:serverId/channels')
	@ApiOperation({ summary: 'List channels in a server' })
	async listByServer(@Param('serverId') serverId: string) {
		return this.channelService.findByServer(serverId);
	}

	@Post('servers/:serverId/channels')
	@ApiOperation({ summary: 'Create a channel in a server' })
	async create(
		@Param('serverId') serverId: string,
		@Body() body: { name: string; type?: string; category_id?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.channelService.create(serverId, userId, body.name, body.type, body.category_id);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Patch('channels/:channelId')
	@ApiOperation({ summary: 'Update a channel' })
	async update(
		@Param('channelId') channelId: string,
		@Body() body: { name?: string; topic?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.channelService.update(channelId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Delete('channels/:channelId')
	@ApiOperation({ summary: 'Delete a channel' })
	async remove(@Param('channelId') channelId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.channelService.delete(channelId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Get('users/@me/channels')
	@ApiOperation({ summary: 'List DM channels for current user' })
	async listDMs(@Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.channelService.findDMChannels(userId);
	}

	@Post('users/@me/channels')
	@ApiOperation({ summary: 'Create or get DM channel' })
	async createDM(@Body() body: { recipient_id: string }, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.channelService.createDM(userId, body.recipient_id);
	}
}
