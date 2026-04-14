import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServerService } from './server.service';
import { Public } from '../auth/public.decorator';

@ApiTags('servers')
@Controller('servers')
export class ServerController {
	constructor(private readonly serverService: ServerService) {}

	@Get('@me')
	@ApiOperation({ summary: 'List servers for current user' })
	async listMine(@Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.serverService.findByMember(userId);
	}

	@Post()
	@ApiOperation({ summary: 'Create a new server' })
	async create(
		@Body()
		body: {
			name: string;
			icon_url?: string;
			banner_url?: string;
			invite_background_url?: string;
			description?: string;
		},
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
	@ApiOperation({ summary: 'Update server' })
	async update(
		@Param('serverId') serverId: string,
		@Body()
		body: {
			name?: string;
			description?: string;
			icon_url?: string | null;
			banner_url?: string | null;
			invite_background_url?: string | null;
		},
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
	@ApiOperation({ summary: 'Create server invite' })
	async createInvite(
		@Param('serverId') serverId: string,
		@Body() body: { max_uses?: number; expires_in?: number },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		return this.serverService.createInvite(serverId, userId, body.max_uses, body.expires_in);
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
