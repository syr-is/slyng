import { Controller, Get, Post, Delete, Param, Body, Query, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MemberService } from './member.service';
import { MessageService } from '../message/message.service';
import { RequirePermission } from '../auth/require-permission.decorator';

function parseIntOr(value: string | undefined, fallback: number): number {
	const n = value ? parseInt(value, 10) : NaN;
	return Number.isFinite(n) ? n : fallback;
}

@ApiTags('members')
@Controller()
export class MemberController {
	constructor(
		private readonly memberService: MemberService,
		private readonly messageService: MessageService
	) {}

	@Get('servers/:serverId/members')
	@ApiOperation({ summary: 'List server members (paginated)' })
	async listMembers(
		@Param('serverId') serverId: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('sort') sort?: string,
		@Query('order') order?: string,
		@Query('q') q?: string
	) {
		// Paginated by default. When no query params are supplied, return the
		// full list to preserve backward-compat with callers that expect an
		// array (e.g. the main member-list rendering).
		const paginated = limit !== undefined || offset !== undefined || sort !== undefined || q !== undefined;
		if (!paginated) {
			return this.memberService.findByServer(serverId);
		}
		return this.memberService.findPageForServer(serverId, {
			limit: parseIntOr(limit, 50),
			offset: parseIntOr(offset, 0),
			sort,
			order: order === 'desc' ? 'desc' : 'asc',
			q
		});
	}

	@Delete('servers/:serverId/members/:userId')
	@RequirePermission('KICK_MEMBERS')
	@ApiOperation({ summary: 'Kick a member (with optional message purge)' })
	async kick(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Query('delete_seconds') deleteSeconds: string | undefined,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			const parsed = deleteSeconds !== undefined ? parseFloat(deleteSeconds) : undefined;
			await this.memberService.kick(serverId, targetUserId, actor, {
				deleteMessageSeconds:
					parsed === undefined || Number.isNaN(parsed) ? undefined : parsed
			});
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('servers/:serverId/bans')
	@RequirePermission('BAN_MEMBERS')
	@ApiOperation({ summary: 'Ban a user (with optional message purge)' })
	async ban(
		@Param('serverId') serverId: string,
		@Body() body: { user_id: string; reason?: string; delete_seconds?: number },
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			await this.memberService.ban(serverId, body.user_id, actor, {
				reason: body.reason,
				deleteMessageSeconds: body.delete_seconds
			});
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('servers/:serverId/bans/:userId')
	@RequirePermission('BAN_MEMBERS')
	@ApiOperation({ summary: 'Unban a user' })
	async unban(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			await this.memberService.unban(serverId, targetUserId, actor);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Get('servers/:serverId/bans')
	@RequirePermission('BAN_MEMBERS')
	@ApiOperation({ summary: 'List server bans (paginated)' })
	async listBans(
		@Param('serverId') serverId: string,
		@Query('limit') limit: string | undefined,
		@Query('offset') offset: string | undefined,
		@Query('sort') sort: string | undefined,
		@Query('order') order: string | undefined,
		@Query('q') q: string | undefined,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			return await this.memberService.listBans(serverId, actor, {
				limit: parseIntOr(limit, 50),
				offset: parseIntOr(offset, 0),
				sort,
				order: order === 'asc' ? 'asc' : 'desc',
				q
			});
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
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

	// ── Moderation view endpoints ──

	@Get('servers/:serverId/members/:userId/messages')
	@RequirePermission('MANAGE_MESSAGES')
	@ApiOperation({ summary: 'Paginated list of a user\'s messages across the server' })
	async memberMessages(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('before') before?: string,
		@Query('q') q?: string,
		@Req() req?: any
	) {
		return this.messageService.findBySender(
			serverId,
			targetUserId,
			{
				limit: parseIntOr(limit, 50),
				offset: parseIntOr(offset, 0),
				before,
				q
			},
			req?.user?.id
		);
	}

	@Get('servers/:serverId/members/:userId/message-stats')
	@RequirePermission('MANAGE_MESSAGES')
	@ApiOperation({ summary: 'Totals / first / last for a user\'s messages in a server' })
	async memberMessageStats(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string
	) {
		return this.messageService.statsForSender(serverId, targetUserId);
	}

	@Post('servers/:serverId/members/:userId/purge')
	@RequirePermission('MANAGE_MESSAGES')
	@ApiOperation({ summary: 'Bulk delete a user\'s messages in the server (no kick/ban)' })
	async purgeMember(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Body() body: { delete_seconds: number },
		@Req() req: any
	) {
		await this.memberService.purgeMessagesPublic(serverId, targetUserId, body.delete_seconds, req.user?.id);
		return { success: true };
	}

	@Get('servers/:serverId/members/:userId/ban-history')
	@RequirePermission('BAN_MEMBERS')
	@ApiOperation({ summary: 'All ban records (active + inactive) for a user in a server' })
	async memberBanHistory(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string
	) {
		return this.memberService.findBanHistoryForUser(serverId, targetUserId);
	}
}
