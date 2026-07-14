import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	HttpException,
	Param,
	Patch,
	Post,
	Query,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { PostCreateDto, PostUpdateDto, PostAssetPresignDto } from '../dto';
import { IdpPublicService } from './idp-public.service';
import { PostService } from './post.service';

/**
 * Post endpoints for local accounts. Owner routes (`/api/posts*`,
 * `/api/uploads/post-assets`) are authed but not server-scoped
 * (@SkipServerAccess); the public reads (`/api/public/posts/*`) are the
 * federation surface the identity manifest advertises. Paths mirror syr's
 * routes/api/posts/* and routes/api/public/posts/*.
 */
@ApiTags('idp')
@Controller()
export class PostController {
	constructor(
		private readonly posts: PostService,
		private readonly publicService: IdpPublicService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	private ownParam(req: Request, didParam: string): string {
		const sessionDid = this.requireDid(req);
		if (decodeURIComponent(didParam) !== sessionDid) {
			throw new HttpException('You do not own this post', 403);
		}
		return sessionDid;
	}

	// ── owner CRUD ──

	@SkipServerAccess()
	@Get('posts')
	@ApiOperation({ summary: "List the caller's posts (any status)" })
	async listOwn(
		@Req() req: Request,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('search') search?: string
	) {
		const did = this.requireDid(req);
		const { posts, total } = await this.posts.listOwn(did, {
			limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
			offset: offset ? Math.max(0, parseInt(offset, 10) || 0) : 0,
			search
		});
		return { status: 'success', data: posts, pagination: { total } };
	}

	@SkipServerAccess()
	@Post('posts')
	@HttpCode(201)
	@ApiOperation({ summary: 'Create a post (draft or completed)' })
	async create(@Req() req: Request, @Body() body: PostCreateDto) {
		const did = this.requireDid(req);
		const data = await this.posts.create(did, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Get('posts/:did/:id')
	@ApiOperation({ summary: 'Get one of the caller’s own posts' })
	async getOwn(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = this.ownParam(req, did);
		const data = await this.posts.getOwn(sessionDid, decodeURIComponent(id));
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Patch('posts/:did/:id')
	@ApiOperation({ summary: 'Update one of the caller’s own posts' })
	async update(
		@Req() req: Request,
		@Param('did') did: string,
		@Param('id') id: string,
		@Body() body: PostUpdateDto
	) {
		const sessionDid = this.ownParam(req, did);
		const data = await this.posts.update(sessionDid, decodeURIComponent(id), body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Delete('posts/:did/:id')
	@ApiOperation({ summary: 'Delete one of the caller’s own posts' })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = this.ownParam(req, did);
		await this.posts.remove(sessionDid, decodeURIComponent(id));
		return { status: 'success', data: { deleted: true } };
	}

	@SkipServerAccess()
	@Post('uploads/post-assets')
	@HttpCode(201)
	@ApiOperation({ summary: 'Presigned PUT for a post media asset' })
	async presignAsset(@Req() req: Request, @Body() body: PostAssetPresignDto) {
		const did = this.requireDid(req);
		const data = await this.posts.presignAsset(did, body);
		return { status: 'success', data };
	}

	// ── public reads (federation surface) ──

	@Public()
	@Get('public/posts/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public posts for a DID (metadata; ?full=1 for content)' })
	async publicList(
		@Param('did') did: string,
		@Query('full') full?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const data = await this.publicService.getPublicPostsByDid(decodeURIComponent(did), {
			full: full === '1',
			limit: limit ? parseInt(limit, 10) : undefined,
			offset: offset ? parseInt(offset, 10) : undefined
		});
		return { status: 'success', data };
	}

	@Public()
	@Get('public/posts/:did/:localId')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'A single public post' })
	async publicSingle(@Param('did') did: string, @Param('localId') localId: string) {
		const data = await this.publicService.getPublicPost(
			decodeURIComponent(did),
			decodeURIComponent(localId)
		);
		return { status: 'success', data };
	}
}
