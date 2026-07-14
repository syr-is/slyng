import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpException,
	Param,
	Post,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { StoryPresignDto, StoryCompleteDto } from '../dto';
import { IdpPublicService } from './idp-public.service';
import { StoryService } from './story.service';

/**
 * Story endpoints for local accounts. Owner routes (`/api/stories*`) are
 * authed but not server-scoped (@SkipServerAccess); the public reel
 * (`/api/public/stories/:did`) is the federation surface the identity
 * manifest advertises. Paths mirror syr's routes/api/stories/*.
 */
@ApiTags('idp')
@Controller()
export class StoryController {
	constructor(
		private readonly stories: StoryService,
		private readonly publicService: IdpPublicService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Get('stories')
	@ApiOperation({ summary: "List the caller's stories (any status)" })
	async listOwn(@Req() req: Request) {
		const did = this.requireDid(req);
		const data = await this.stories.listOwn(did);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('stories/presign')
	@ApiOperation({ summary: 'Presigned PUT for a new story slide' })
	async presign(@Req() req: Request, @Body() body: StoryPresignDto) {
		const did = this.requireDid(req);
		const data = await this.stories.presign(did, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('stories/:id/complete')
	@ApiOperation({ summary: 'Finalize a story after the S3 PUT succeeds' })
	async complete(
		@Req() req: Request,
		@Param('id') id: string,
		@Body() body: StoryCompleteDto
	) {
		const did = this.requireDid(req);
		const data = await this.stories.complete(did, id, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Delete('stories/:did/:id')
	@ApiOperation({ summary: 'Delete a story (owner only)' })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = this.requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this story', 403);
		}
		await this.stories.remove(sessionDid, id);
		return { status: 'success', data: { deleted: true } };
	}

	@Public()
	@Get('public/stories/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public 24h story reel for a DID' })
	async publicReel(@Param('did') did: string) {
		const data = await this.publicService.getPublicStories(decodeURIComponent(did));
		return { status: 'success', data };
	}
}
