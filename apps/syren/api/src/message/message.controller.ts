import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MessageService } from './message.service';
import { RequirePermission } from '../auth/require-permission.decorator';

@ApiTags('messages')
@Controller('channels/:channelId')
export class MessageController {
	constructor(private readonly messageService: MessageService) {}

	@Get('messages')
	@ApiOperation({ summary: 'Get messages in a channel' })
	async list(
		@Param('channelId') channelId: string,
		@Query('before') before?: string,
		@Query('limit') limit?: string,
		@Req() req?: any
	) {
		return this.messageService.findByChannel(
			channelId,
			{ before, limit: limit ? parseInt(limit, 10) : undefined },
			req?.user?.id
		);
	}

	@Post('messages')
	@ApiOperation({ summary: 'Send a message' })
	async create(
		@Param('channelId') channelId: string,
		@Body()
		body: {
			content?: string;
			reply_to?: string | string[];
			attachments?: Array<{
				url: string;
				filename: string;
				mime_type: string;
				size: number;
				width?: number;
				height?: number;
			}>;
		},
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		const content = body.content ?? '';
		const attachments = body.attachments ?? [];
		if (!content.trim() && attachments.length === 0) {
			throw new HttpException('Message must have content or attachments', 400);
		}
		// Accept either a single ID (legacy) or an array. Cap at 5.
		const replyIds = Array.isArray(body.reply_to)
			? body.reply_to
			: body.reply_to
				? [body.reply_to]
				: [];
		if (replyIds.length > 5) {
			throw new HttpException('Cannot reply to more than 5 messages', 400);
		}
		return this.messageService.create(channelId, userId, content, replyIds, attachments);
	}

	@Patch('messages/:messageId')
	@ApiOperation({ summary: 'Edit a message' })
	async update(
		@Param('messageId') messageId: string,
		@Body() body: { content: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.messageService.update(messageId, userId, body.content);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('messages/:messageId')
	@ApiOperation({ summary: 'Delete a message' })
	async delete(@Param('messageId') messageId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.messageService.delete(messageId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('messages/:messageId/embeds')
	@ApiOperation({ summary: 'Clear embeds on own message' })
	async clearEmbeds(@Param('messageId') messageId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.messageService.clearEmbeds(messageId, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('messages/:messageId/reactions')
	@ApiOperation({ summary: 'Add reaction to a message' })
	async addReaction(
		@Param('channelId') channelId: string,
		@Param('messageId') messageId: string,
		@Body() body: { kind: string; value: string; image_url?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		await this.messageService.addReaction(channelId, messageId, userId, body.kind, body.value, body.image_url);
		return { success: true };
	}

	@Delete('messages/:messageId/reactions')
	@ApiOperation({ summary: 'Remove reaction from a message' })
	async removeReaction(
		@Param('channelId') channelId: string,
		@Param('messageId') messageId: string,
		@Body() body: { value: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		await this.messageService.removeReaction(channelId, messageId, userId, body.value);
		return { success: true };
	}

	@Get('pins')
	@ApiOperation({ summary: 'Get pinned messages' })
	async listPins(@Param('channelId') channelId: string) {
		return this.messageService.findPinned(channelId);
	}

	@Post('pins')
	@RequirePermission('MANAGE_MESSAGES')
	@ApiOperation({ summary: 'Pin a message' })
	async pin(
		@Param('channelId') channelId: string,
		@Body() body: { message_id: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.messageService.pin(channelId, body.message_id, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('pins/:messageId')
	@RequirePermission('MANAGE_MESSAGES')
	@ApiOperation({ summary: 'Unpin a message' })
	async unpin(
		@Param('channelId') channelId: string,
		@Param('messageId') messageId: string,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.messageService.unpin(channelId, messageId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}
}
