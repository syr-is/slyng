import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { RequirePermission } from '../auth/require-permission.decorator';

@ApiTags('roles')
@Controller()
export class RoleController {
	constructor(private readonly roles: RoleService) {}

	@Get('servers/:serverId/roles')
	@ApiOperation({ summary: 'List roles in a server' })
	async list(@Param('serverId') serverId: string) {
		return this.roles.findByServer(serverId);
	}

	@Post('servers/:serverId/roles')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Create a role' })
	async create(
		@Param('serverId') serverId: string,
		@Body() body: { name: string; color?: string | null; permissions?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.create(serverId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Patch('roles/:roleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Update a role' })
	async update(
		@Param('roleId') roleId: string,
		@Body() body: { name?: string; color?: string | null; permissions?: string; position?: number },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.update(roleId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('roles/:roleId/swap/:otherRoleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Swap position with another role (hierarchy reorder)' })
	async swap(
		@Param('roleId') roleId: string,
		@Param('otherRoleId') otherRoleId: string,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.swapPositions(roleId, otherRoleId, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('roles/:roleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Delete a role' })
	async remove(@Param('roleId') roleId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.roles.delete(roleId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('servers/:serverId/members/:userId/roles/:roleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Assign a role to a member' })
	async assign(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Param('roleId') roleId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.assignToMember(serverId, targetUserId, roleId, actor);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('servers/:serverId/members/:userId/roles/:roleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Unassign a role from a member' })
	async unassign(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Param('roleId') roleId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.unassignFromMember(serverId, targetUserId, roleId, actor);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Get('servers/:serverId/members/@me/permissions')
	@ApiOperation({ summary: 'Get the current user’s effective permissions in a server' })
	async myPermissions(@Param('serverId') serverId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		const perms = await this.roles.computePermissions(userId, serverId);
		return { permissions: perms.toString() };
	}
}
