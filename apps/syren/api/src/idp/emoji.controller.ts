import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpException,
	Param,
	Post,
	Query,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { EmojiPresignDto, EmojiCompleteDto } from '../dto';
import { EmojiService } from './emoji.service';
import { IdpPublicService } from './idp-public.service';

/**
 * Custom-emoji endpoints for local accounts. Owner routes (`/api/emojis*`) are
 * authed but not server-scoped (@SkipServerAccess); the public list
 * (`/api/public/emojis/:did`) is the federation surface the identity manifest
 * advertises and syren's emoji store consumes. Paths mirror syr's routes.
 */
@ApiTags('idp')
@Controller()
export class EmojiController {
	constructor(
		private readonly emojis: EmojiService,
		private readonly publicService: IdpPublicService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Get('emojis')
	@ApiOperation({ summary: "List the caller's emoji (any status)" })
	async listOwn(@Req() req: Request) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.emojis.listOwn(did) };
	}

	@SkipServerAccess()
	@Post('emojis/presign')
	@ApiOperation({ summary: 'Presigned PUT for a new emoji' })
	async presign(@Req() req: Request, @Body() body: EmojiPresignDto) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.emojis.presign(did, body) };
	}

	@SkipServerAccess()
	@Post('emojis/:id/complete')
	@ApiOperation({ summary: 'Finalize an emoji after the S3 PUT succeeds' })
	async complete(@Req() req: Request, @Param('id') id: string, @Body() body: EmojiCompleteDto) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.emojis.complete(did, id, body) };
	}

	@SkipServerAccess()
	@Delete('emojis/:did/:id')
	@ApiOperation({ summary: 'Delete an emoji (owner only)' })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = this.requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this emoji', 403);
		}
		await this.emojis.remove(sessionDid, id);
		return { status: 'success', data: { deleted: true } };
	}

	@Public()
	@Get('public/emojis/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public emoji list for a DID (paginated)' })
	async publicList(
		@Param('did') did: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const res = await this.publicService.getPublicEmojisByDid(decodeURIComponent(did), {
			limit: limit ? Number(limit) : undefined,
			offset: offset ? Number(offset) : undefined
		});
		return { status: 'success', ...res };
	}
}
