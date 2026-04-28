import { Controller, Get, Post, Delete, Body, Param, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RelationService } from './relation.service';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { PaginatedQuery, type PaginationOptions } from '../common/pagination';
import { BlockUserDto, FriendSendDto, IgnoreUserDto } from '../dto';

@ApiTags('relations')
@Controller('users/@me')
@SkipServerAccess()
export class RelationController {
	constructor(private readonly relations: RelationService) {}

	@Get('relations')
	@ApiOperation({ summary: 'Full relations snapshot for the current user' })
	async snapshot(@Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.relations.relationsFor(userId);
	}

	// ── Friends + requests ──

	@Get('friends')
	@ApiOperation({ summary: 'Paginated accepted friends' })
	async listFriends(@PaginatedQuery() p: PaginationOptions, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.relations.listFriends(userId, p);
	}

	@Post('friends')
	@ApiOperation({ summary: 'Send a friend request' })
	async sendRequest(@Body() body: FriendSendDto, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		if (!body?.user_id) throw new HttpException('user_id required', 400);
		try {
			return await this.relations.sendFriendRequest(userId, body.user_id, body.syr_instance_url);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('friends/:userId/accept')
	@ApiOperation({ summary: 'Accept an incoming friend request' })
	async accept(@Param('userId') requester: string, @Req() req: any) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			return await this.relations.acceptFriendRequest(actor, requester);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('friends/:userId/decline')
	@ApiOperation({ summary: 'Decline an incoming friend request' })
	async decline(@Param('userId') requester: string, @Req() req: any) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			await this.relations.declineFriendRequest(actor, requester);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('friends/:userId')
	@ApiOperation({ summary: 'Cancel outgoing request OR unfriend accepted' })
	async removeOrCancel(@Param('userId') other: string, @Req() req: any) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		// Try cancel first (outgoing pending); fall through to remove (accepted).
		try {
			await this.relations.cancelFriendRequest(actor, other);
			return { success: true, action: 'cancelled' };
		} catch {
			try {
				await this.relations.removeFriend(actor, other);
				return { success: true, action: 'unfriended' };
			} catch (err) {
				throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
			}
		}
	}

	// ── Block list ──

	@Get('blocklist')
	@ApiOperation({ summary: 'Paginated blocklist' })
	async listBlocked(@PaginatedQuery() p: PaginationOptions, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.relations.listBlocked(userId, p);
	}

	@Post('blocklist')
	@ApiOperation({ summary: 'Block a user (auto-unfriends + strips ignore)' })
	async block(@Body() body: BlockUserDto, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		if (!body?.user_id) throw new HttpException('user_id required', 400);
		try {
			return await this.relations.block(userId, body.user_id);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('blocklist/:userId')
	@ApiOperation({ summary: 'Unblock a user' })
	async unblock(@Param('userId') target: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.relations.unblock(userId, target);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	// ── Ignore list ──

	@Get('ignorelist')
	@ApiOperation({ summary: 'Paginated ignorelist' })
	async listIgnored(@PaginatedQuery() p: PaginationOptions, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.relations.listIgnored(userId, p);
	}

	@Post('ignorelist')
	@ApiOperation({ summary: 'Ignore a user' })
	async ignore(@Body() body: IgnoreUserDto, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		if (!body?.user_id) throw new HttpException('user_id required', 400);
		try {
			return await this.relations.ignore(userId, body.user_id);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('ignorelist/:userId')
	@ApiOperation({ summary: 'Unignore a user' })
	async unignore(@Param('userId') target: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.relations.unignore(userId, target);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}
}
