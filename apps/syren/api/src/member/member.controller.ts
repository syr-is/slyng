import { Controller, Get, Post, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MemberService } from './member.service';

@ApiTags('members')
@Controller()
export class MemberController {
	constructor(private readonly memberService: MemberService) {}

	@Get('servers/:serverId/members')
	@ApiOperation({ summary: 'List server members' })
	async listMembers(@Param('serverId') serverId: string) {
		return this.memberService.findByServer(serverId);
	}

	@Delete('servers/:serverId/members/:userId')
	@ApiOperation({ summary: 'Kick a member from the server' })
	async kick(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			await this.memberService.kick(serverId, targetUserId, actor);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('channels/:channelId/read')
	@ApiOperation({ summary: 'Mark channel as read' })
	async markRead(
		@Param('channelId') channelId: string,
		@Body() body: { last_message_id: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		await this.memberService.markChannelRead(userId, channelId, body.last_message_id);
		return { success: true };
	}
}
