import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServerService } from './server.service';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PaginatedQuery, type PaginationOptions } from '../common/pagination';
import {
	CreateInviteDto,
	CreateServerDto,
	TransferOwnershipDto,
	UpdateInviteDto,
	UpdateServerDto
} from '../dto';

@ApiTags('servers')
@Controller('servers')
export class ServerController {
	constructor(private readonly serverService: ServerService) {}

	@Get('@me')
	@SkipServerAccess()
	@ApiOperation({ summary: 'List servers for current user' })
	async listMine(@Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.serverService.findByMember(userId);
	}

	@Post()
	@SkipServerAccess()
	@ApiOperation({ summary: 'Create a new server' })
	async create(
		@Body() body: CreateServerDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.serverService.create(userId, body.name, {
			iconUrl: body.icon_url,
			bannerUrl: body.banner_url,
			inviteBackgroundUrl: body.invite_background_url,
			description: body.description
		});
	}

	@Get(':serverId')
	@ApiOperation({ summary: 'Get server details' })
	async findOne(@Param('serverId') serverId: string) {
		const server = await this.serverService.findById(serverId);
		if (!server) throw new HttpException('Server not found', 404);
		return server;
	}

	@Patch(':serverId')
	@RequirePermission('MANAGE_SERVER')
	@ApiOperation({ summary: 'Update server' })
	async update(
		@Param('serverId') serverId: string,
		@Body() body: UpdateServerDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.update(serverId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post(':serverId/transfer-ownership')
	@ApiOperation({ summary: 'Transfer server ownership to another member (owner only)' })
	async transferOwnership(
		@Param('serverId') serverId: string,
		@Body() body: TransferOwnershipDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.transferOwnership(serverId, userId, body.new_owner_id);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete(':serverId')
	@ApiOperation({ summary: 'Delete server (owner only)' })
	async remove(@Param('serverId') serverId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.serverService.delete(serverId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post(':serverId/invites')
	@RequirePermission('CREATE_INVITES')
	@ApiOperation({ summary: 'Create server invite' })
	async createInvite(
		@Param('serverId') serverId: string,
		@Body() body: CreateInviteDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.createInvite(serverId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Get(':serverId/invites')
	@RequirePermission('MANAGE_INVITES')
	@ApiOperation({ summary: 'List server invites (paginated)' })
	async listInvites(
		@Param('serverId') serverId: string,
		@PaginatedQuery() p: PaginationOptions,
		@Req() req?: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.listInvites(serverId, userId, {
				...p,
				order: p.order ?? 'desc'
			});
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 403);
		}
	}

	@Patch(':serverId/invites/:code')
	@ApiOperation({ summary: 'Edit invite label (creator or MANAGE_INVITES)' })
	async updateInvite(
		@Param('serverId') serverId: string,
		@Param('code') code: string,
		@Body() body: UpdateInviteDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.updateInvite(serverId, code, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete(':serverId/invites/:code')
	@ApiOperation({ summary: 'Revoke an invite (creator can always revoke their own; others need MANAGE_INVITES)' })
	async deleteInvite(
		@Param('serverId') serverId: string,
		@Param('code') code: string,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.serverService.deleteInvite(serverId, code, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}
}

@ApiTags('invites')
@Controller('invites')
export class InviteController {
	constructor(private readonly serverService: ServerService) {}

	@Public()
	@Get(':code')
	@ApiOperation({ summary: 'Get invite preview (no auth required)' })
	async preview(@Param('code') code: string) {
		try {
			return await this.serverService.findInvitePreview(code);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Invalid invite', 404);
		}
	}

	@Post(':code')
	@SkipServerAccess()
	@ApiOperation({ summary: 'Join server via invite code' })
	async join(@Param('code') code: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.serverService.joinByInvite(userId, code);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed to join', 400);
		}
	}
}
