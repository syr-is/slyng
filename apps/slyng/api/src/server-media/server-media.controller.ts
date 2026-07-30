import {
	Body,
	Controller,
	Delete,
	Get,
	HttpException,
	Param,
	Post,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermission } from '../auth/require-permission.decorator';
import { EmojiPresignDto, EmojiCompleteDto, GifPresignDto, GifCompleteDto } from '../dto';
import {
	ServerMediaService,
	MAX_SERVER_EMOJIS,
	MAX_SERVER_GIFS
} from './server-media.service';

/**
 * Server-owned emoji/sticker + GIF sets. Reads (`GET`) are open to any member
 * (ServerAccessGuard enforces membership); mutations require `MANAGE_EMOJIS`.
 * Members use a server's emoji platform-wide — the client store loads every
 * server they're in and merges the sets into the composer + renderer.
 */
@ApiTags('server-media')
@Controller()
export class ServerMediaController {
	constructor(private readonly media: ServerMediaService) {}

	private actor(req: Request): string {
		const id = (req as Request & { user?: { id?: string } }).user?.id;
		if (!id) throw new HttpException('Unauthorized', 401);
		return id;
	}

	// ── Emoji ──

	@Get('servers/:serverId/emojis')
	@ApiOperation({ summary: "List a server's custom emoji (members)" })
	async listEmojis(@Param('serverId') serverId: string) {
		return {
			status: 'success',
			data: await this.media.listEmojis(serverId),
			limit: MAX_SERVER_EMOJIS
		};
	}

	@Post('servers/:serverId/emojis/presign')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Presigned PUT for a new server emoji' })
	async presignEmoji(
		@Param('serverId') serverId: string,
		@Body() body: EmojiPresignDto,
		@Req() req: Request
	) {
		return {
			status: 'success',
			data: await this.media.presignEmoji(serverId, this.actor(req), body)
		};
	}

	@Post('servers/:serverId/emojis/:id/complete')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Finalize a server emoji after the S3 PUT' })
	async completeEmoji(
		@Param('serverId') serverId: string,
		@Param('id') id: string,
		@Body() body: EmojiCompleteDto,
		@Req() req: Request
	) {
		return {
			status: 'success',
			data: await this.media.completeEmoji(serverId, this.actor(req), decodeURIComponent(id), body)
		};
	}

	@Delete('servers/:serverId/emojis/:id')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Delete a server emoji' })
	async removeEmoji(
		@Param('serverId') serverId: string,
		@Param('id') id: string,
		@Req() req: Request
	) {
		await this.media.removeEmoji(serverId, this.actor(req), decodeURIComponent(id));
		return { status: 'success', data: { deleted: true } };
	}

	// ── GIF ──

	@Get('servers/:serverId/gifs')
	@ApiOperation({ summary: "List a server's custom GIFs (members)" })
	async listGifs(@Param('serverId') serverId: string) {
		return {
			status: 'success',
			data: await this.media.listGifs(serverId),
			limit: MAX_SERVER_GIFS
		};
	}

	@Post('servers/:serverId/gifs/presign')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Presigned PUT for a new server GIF' })
	async presignGif(
		@Param('serverId') serverId: string,
		@Body() body: GifPresignDto,
		@Req() req: Request
	) {
		return {
			status: 'success',
			data: await this.media.presignGif(serverId, this.actor(req), body)
		};
	}

	@Post('servers/:serverId/gifs/:id/complete')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Finalize a server GIF after the S3 PUT' })
	async completeGif(
		@Param('serverId') serverId: string,
		@Param('id') id: string,
		@Body() body: GifCompleteDto,
		@Req() req: Request
	) {
		return {
			status: 'success',
			data: await this.media.completeGif(serverId, this.actor(req), decodeURIComponent(id), body)
		};
	}

	@Delete('servers/:serverId/gifs/:id')
	@RequirePermission('MANAGE_EMOJIS')
	@ApiOperation({ summary: 'Delete a server GIF' })
	async removeGif(
		@Param('serverId') serverId: string,
		@Param('id') id: string,
		@Req() req: Request
	) {
		await this.media.removeGif(serverId, this.actor(req), decodeURIComponent(id));
		return { status: 'success', data: { deleted: true } };
	}
}
