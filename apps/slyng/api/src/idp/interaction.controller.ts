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
import { isValidSyrDid } from '@slyng/idp-crypto';
import type { ReactionParentType } from '@slyng/types';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { CommentCreateDto, CommentUpdateDto, ReactionCreateDto, FollowCreateDto, FollowVisibilityDto } from '../dto';
import { CommentService } from './comment.service';
import { ReactionService } from './reaction.service';
import { FollowService } from './follow.service';

/**
 * P8 interaction endpoints for local accounts: comments, reactions, follows.
 * Owner routes are authed-but-not-server-scoped (@SkipServerAccess); the
 * `/api/public/*` reads are the federation surface the identity manifest
 * advertises.
 *
 * Two flavours of public read:
 *   • `public/comments/:did` / `public/reactions/:did` — per-author, byte-for-
 *     byte syr's contract (a foreign syr instance reads these, and P11 export
 *     walks them).
 *   • `public/threads/*` — by-target aggregation (every interaction hosted on
 *     this instance for a post/comment). syr has no equivalent — it fans out
 *     over the viewer's follow graph — but slyng is a community app where a
 *     post's whole thread should be visible instance-wide. Cross-instance
 *     fan-in is the registry's job (P9).
 */

function requireDid(req: Request): string {
	const did = (req as Request & { user?: { did?: string } }).user?.did;
	if (!did) throw new HttpException('Not authenticated', 401);
	return did;
}

/**
 * Validate a `:did` path param on the public federation reads. syr's
 * routes/api/public/{comments,reactions,following} reject a malformed DID with
 * 400 before touching the DB — slyng matches so a foreign syr consumer sees the
 * identical contract (and it's consistent with our public posts/hash reads).
 */
function assertPublicDid(raw: string): string {
	const did = decodeURIComponent(raw);
	if (!isValidSyrDid(did)) throw new HttpException('Invalid DID', 400);
	return did;
}

@ApiTags('idp')
@Controller()
export class CommentController {
	constructor(private readonly comments: CommentService) {}

	@SkipServerAccess()
	@Post('comments')
	@HttpCode(201)
	@ApiOperation({ summary: 'Create a comment on a post' })
	async create(@Req() req: Request, @Body() body: CommentCreateDto) {
		const did = requireDid(req);
		return { status: 'success', data: await this.comments.create(did, body) };
	}

	@SkipServerAccess()
	@Get('comments')
	@ApiOperation({ summary: "List the caller's own comments" })
	async listOwn(
		@Req() req: Request,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const did = requireDid(req);
		const { comments, total } = await this.comments.listOwn(did, {
			limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
			offset: offset ? Math.max(0, parseInt(offset, 10) || 0) : 0
		});
		return { status: 'success', data: comments, pagination: { total } };
	}

	@SkipServerAccess()
	@Get('comments/:did/:id')
	@ApiOperation({ summary: "Get one of the caller's own comments" })
	async getOwn(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this comment', 403);
		}
		return { status: 'success', data: await this.comments.getOwn(sessionDid, decodeURIComponent(id)) };
	}

	@SkipServerAccess()
	@Patch('comments/:did/:id')
	@ApiOperation({ summary: "Update one of the caller's own comments" })
	async update(
		@Req() req: Request,
		@Param('did') did: string,
		@Param('id') id: string,
		@Body() body: CommentUpdateDto
	) {
		const sessionDid = requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this comment', 403);
		}
		return {
			status: 'success',
			data: await this.comments.update(sessionDid, decodeURIComponent(id), body)
		};
	}

	@SkipServerAccess()
	@Delete('comments/:did/:id')
	@ApiOperation({ summary: "Delete one of the caller's own comments" })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this comment', 403);
		}
		await this.comments.remove(sessionDid, decodeURIComponent(id));
		return { status: 'success', data: { deleted: true } };
	}

	// ── public reads ──

	@Public()
	@Get('public/comments/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public comments authored by a DID (per-author; ?post_did&post_id filter)' })
	async publicByAuthor(
		@Param('did') did: string,
		@Query('post_did') postDid?: string,
		@Query('post_id') postId?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		return {
			status: 'success',
			...(await this.comments.listByAuthor(assertPublicDid(did), {
				postDid: postDid || undefined,
				postId: postId || undefined,
				limit: limit ? parseInt(limit, 10) : undefined,
				offset: offset ? parseInt(offset, 10) : undefined
			}))
		};
	}

	@Public()
	@Get('public/threads/comments/:did/:id')
	@Header('Cache-Control', 'public, max-age=10')
	@ApiOperation({ summary: 'Every comment hosted here for a post (by-target aggregation)' })
	async publicByTarget(
		@Param('did') did: string,
		@Param('id') id: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		return {
			status: 'success',
			...(await this.comments.listByTarget(decodeURIComponent(did), decodeURIComponent(id), {
				limit: limit ? parseInt(limit, 10) : undefined,
				offset: offset ? parseInt(offset, 10) : undefined
			}))
		};
	}
}

@ApiTags('idp')
@Controller()
export class ReactionController {
	constructor(private readonly reactions: ReactionService) {}

	@SkipServerAccess()
	@Post('reactions')
	@ApiOperation({ summary: 'Toggle a reaction on a post or comment' })
	async toggle(@Req() req: Request, @Body() body: ReactionCreateDto) {
		const did = requireDid(req);
		const result = await this.reactions.toggle(did, body);
		return { status: 'success', ...result };
	}

	@SkipServerAccess()
	@Delete('reactions/:did/:id')
	@ApiOperation({ summary: "Delete one of the caller's own reactions" })
	async remove(@Req() req: Request, @Param('did') did: string, @Param('id') id: string) {
		const sessionDid = requireDid(req);
		if (decodeURIComponent(did) !== sessionDid) {
			throw new HttpException('You do not own this reaction', 403);
		}
		await this.reactions.remove(sessionDid, decodeURIComponent(id));
		return { status: 'success', data: { deleted: true } };
	}

	// ── public reads ──

	@Public()
	@Get('public/reactions/:did')
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ summary: 'Public reactions authored by a DID (per-author; parent trio filter)' })
	async publicByAuthor(
		@Param('did') did: string,
		@Query('parent_type') parentType?: string,
		@Query('parent_did') parentDid?: string,
		@Query('parent_id') parentId?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		// All-or-none on the parent trio, matching syr's route.
		const trio = [parentType, parentDid, parentId].filter((v) => v !== undefined && v !== '');
		if (trio.length !== 0 && trio.length !== 3) {
			throw new HttpException('parent_type, parent_did and parent_id must be provided together', 400);
		}
		return {
			status: 'success',
			...(await this.reactions.listByAuthor(assertPublicDid(did), {
				parentType: this.parentType(parentType),
				parentDid: parentDid || undefined,
				parentId: parentId || undefined,
				limit: limit ? parseInt(limit, 10) : undefined,
				offset: offset ? parseInt(offset, 10) : undefined
			}))
		};
	}

	@Public()
	@Get('public/threads/reactions/:type/:did/:id')
	@Header('Cache-Control', 'public, max-age=10')
	@ApiOperation({ summary: 'Every reaction hosted here on a target (by-target aggregation)' })
	async publicByTarget(
		@Param('type') type: string,
		@Param('did') did: string,
		@Param('id') id: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const parentType = this.parentType(type);
		if (!parentType) throw new HttpException('type must be "post" or "comment"', 400);
		return {
			status: 'success',
			...(await this.reactions.listByTarget(parentType, decodeURIComponent(did), decodeURIComponent(id), {
				limit: limit ? parseInt(limit, 10) : undefined,
				offset: offset ? parseInt(offset, 10) : undefined
			}))
		};
	}

	private parentType(raw: string | undefined): ReactionParentType | undefined {
		return raw === 'post' || raw === 'comment' ? raw : undefined;
	}
}

@ApiTags('idp')
@Controller()
export class FollowController {
	constructor(private readonly follows: FollowService) {}

	@SkipServerAccess()
	@Get('follows')
	@ApiOperation({ summary: "List the caller's following" })
	async listOwn(@Req() req: Request) {
		const did = requireDid(req);
		return { status: 'success', data: await this.follows.listOwn(did) };
	}

	@SkipServerAccess()
	@Post('follows')
	@ApiOperation({ summary: 'Follow a DID' })
	async follow(@Req() req: Request, @Body() body: FollowCreateDto) {
		const did = requireDid(req);
		return { status: 'success', data: await this.follows.follow(did, body) };
	}

	@SkipServerAccess()
	@Delete('follows')
	@ApiOperation({ summary: 'Unfollow a DID' })
	async unfollow(
		@Req() req: Request,
		@Query('followed_did') followedDid?: string,
		@Query('provider_url') providerUrl?: string
	) {
		const did = requireDid(req);
		if (!followedDid) throw new HttpException('followed_did is required', 400);
		await this.follows.unfollow(did, {
			followed_did: decodeURIComponent(followedDid),
			provider_url: providerUrl ? decodeURIComponent(providerUrl) : undefined
		});
		return { status: 'success', data: { unfollowed: true } };
	}

	@SkipServerAccess()
	@Patch('follows/visibility')
	@ApiOperation({ summary: 'Toggle whether a follow appears on the public list' })
	async setVisibility(@Req() req: Request, @Body() body: FollowVisibilityDto) {
		const did = requireDid(req);
		return { status: 'success', data: await this.follows.setVisibility(did, body) };
	}

	@SkipServerAccess()
	@Get('follows/check')
	@ApiOperation({ summary: 'Whether the caller follows a DID' })
	async check(
		@Req() req: Request,
		@Query('did') followedDid?: string,
		@Query('provider') provider?: string
	) {
		const did = requireDid(req);
		if (!followedDid) throw new HttpException('did is required', 400);
		return {
			status: 'success',
			data: await this.follows.check(did, {
				followed_did: decodeURIComponent(followedDid),
				provider_url: provider ? decodeURIComponent(provider) : undefined
			})
		};
	}

	// ── public read ──

	@Public()
	@Get('public/following/:did')
	@Header('Cache-Control', 'public, max-age=30')
	@ApiOperation({ summary: 'Public following list for a DID' })
	async publicFollowing(@Param('did') did: string) {
		return { status: 'success', ...(await this.follows.listPublic(assertPublicDid(did))) };
	}
}
