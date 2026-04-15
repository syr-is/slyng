import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChannelService } from './channel.service';
import { MessageService } from '../message/message.service';
import { RequirePermission } from '../auth/require-permission.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { PaginatedQuery, type DateRangeOptions } from '../common/pagination';

@ApiTags('channels')
@Controller()
export class ChannelController {
	constructor(
		private readonly channelService: ChannelService,
		private readonly messageService: MessageService
	) {}

	@Get('servers/:serverId/channels')
	@ApiOperation({ summary: 'List channels in a server' })
	async listByServer(@Param('serverId') serverId: string) {
		return this.channelService.findByServer(serverId);
	}

	@Post('servers/:serverId/channels')
	@RequirePermission('MANAGE_CHANNELS')
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
	@RequirePermission('MANAGE_CHANNELS')
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
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Soft-delete a channel (move to trash)' })
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

	@Get('servers/:serverId/trash/channels')
	@RequirePermission('VIEW_TRASH')
	@ApiOperation({ summary: 'List soft-deleted channels for a server' })
	async listTrashed(@Param('serverId') serverId: string) {
		return this.channelService.listTrashedForServer(serverId);
	}

	@Get('servers/:serverId/trash/messages')
	@RequirePermission('VIEW_TRASH')
	@ApiOperation({ summary: 'List soft-deleted messages across all channels in a server (paginated)' })
	async listTrashedMessages(
		@Param('serverId') serverId: string,
		@PaginatedQuery({ dateRange: true }) p: DateRangeOptions,
		@Query('before') before?: string,
		@Query('sender_id') senderId?: string,
		@Query('deleted_by') deletedBy?: string
	) {
		return this.messageService.findTrashedInServer(serverId, {
			...p,
			before,
			sender_id: senderId,
			deleted_by: deletedBy
		});
	}

	@Post('channels/:channelId/restore')
	@RequirePermission('VIEW_TRASH')
	@ApiOperation({ summary: 'Restore a soft-deleted channel' })
	async restore(@Param('channelId') channelId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.channelService.restore(channelId, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Delete('channels/:channelId/hard')
	@RequirePermission('HARD_DELETE')
	@ApiOperation({ summary: 'Permanently delete a trashed channel and its messages' })
	async hardDelete(@Param('channelId') channelId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.channelService.hardDelete(channelId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Get('users/@me/channels')
	@SkipServerAccess()
	@ApiOperation({ summary: 'List DM channels for current user' })
	async listDMs(@Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.channelService.findDMChannels(userId);
	}

	@Post('users/@me/channels')
	@SkipServerAccess()
	@ApiOperation({ summary: 'Create or get DM channel' })
	async createDM(@Body() body: { recipient_id: string }, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.channelService.createDM(userId, body.recipient_id);
	}
}
