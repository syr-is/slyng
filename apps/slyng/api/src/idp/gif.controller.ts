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
import { GifPresignDto, GifCompleteDto } from '../dto';
import { GifService } from './gif.service';
import { IdpPublicService } from './idp-public.service';

/**
 * Personal-GIF endpoints for local accounts. Owner routes (`/api/gifs*`) are
 * authed but not server-scoped (@SkipServerAccess); the public list
 * (`/api/public/gifs/:did`) is the federation surface slyng's gif store
 * consumes. Paths mirror syr's routes; public list adds an optional `search`
 * over tags.
 */
@ApiTags('idp')
@Controller()
export class GifController {
	constructor(
		private readonly gifs: GifService,
		private readonly publicService: IdpPublicService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Get('gifs')
	@ApiOperation({ summary: "List the caller's GIFs (any status)" })
	async listOwn(@Req() req: Request) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.gifs.listOwn(did) };
	}

	@SkipServerAccess()
	@Post('gifs/presign')
	@ApiOperation({ summary: 'Presigned PUT for a new GIF' })
	async presign(@Req() req: Request, @Body() body: GifPresignDto) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.gifs.presign(did, body) };
	}

	@SkipServerAccess()
	@Post('gifs/:id/complete')
	@ApiOperation({ summary: 'Finalize a GIF after the S3 PUT succeeds' })
	async complete(@Req() req: Request, @Param('id') id: string, @Body() body: GifCompleteDto) {
		const did = this.requireDid(req);
		return { status: 'success', data: await this.gifs.complete(did, id, body) };
	}

	@SkipServerAccess()
	@Delete('gifs/:did/:id')
	@ApiOperation({ summary: 'Delete a GIF (owner only)' })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = this.requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this GIF', 403);
		}
		await this.gifs.remove(sessionDid, id);
		return { status: 'success', data: { deleted: true } };
	}

	@Public()
	@Get('public/gifs/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public GIF list for a DID (paginated, tag search)' })
	async publicList(
		@Param('did') did: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('search') search?: string
	) {
		const res = await this.publicService.getPublicGifsByDid(decodeURIComponent(did), {
			limit: limit ? Number(limit) : undefined,
			offset: offset ? Number(offset) : undefined,
			search
		});
		return { status: 'success', ...res };
	}
}
