import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateRoleDto, RoleReorderDto, UpdateRoleDto } from '../dto';

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
		@Body() body: CreateRoleDto,
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
		@Body() body: UpdateRoleDto,
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

	@Post('servers/:serverId/roles/reorder')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Bulk reorder roles by position (drag-and-drop)' })
	async reorder(
		@Param('serverId') serverId: string,
		@Body() body: RoleReorderDto,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.reorder(serverId, body.roleIds, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('roles/:roleId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Soft-delete a role (move to trash)' })
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

	@Get('servers/:serverId/trash/roles')
	@RequirePermission('VIEW_TRASH')
	@ApiOperation({ summary: 'List soft-deleted roles for a server' })
	async listTrashed(@Param('serverId') serverId: string) {
		return this.roles.listTrashedForServer(serverId);
	}

	@Post('roles/:roleId/restore')
	@RequirePermission('VIEW_TRASH')
	@ApiOperation({ summary: 'Restore a soft-deleted role' })
	async restore(@Param('roleId') roleId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.roles.restore(roleId, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('roles/:roleId/hard')
	@RequirePermission('HARD_DELETE')
	@ApiOperation({ summary: 'Permanently delete a trashed role and scrub from members' })
	async hardDelete(@Param('roleId') roleId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.roles.hardDelete(roleId, userId);
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

	@Get('servers/:serverId/members/:userId/permission-tree')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Get nested permission tree for a member (server > category > channel)' })
	async permissionTree(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		if (targetUserId === '@me') throw new HttpException('Use /permissions for self', 400);
		if (!(await this.roles.canActorManageMember(actor, serverId, targetUserId))) {
			throw new HttpException("Target member's role is at or above yours", 403);
		}
		return this.roles.buildPermissionTree(targetUserId, serverId);
	}

	@Get('servers/:serverId/members/:userId/permissions')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Get another member effective permissions (requires MANAGE_ROLES + hierarchy)' })
	async memberPermissions(
		@Param('serverId') serverId: string,
		@Param('userId') targetUserId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		// @me is handled by myPermissions — forward if the dynamic param matches
		if (targetUserId === '@me') return this.myPermissions(serverId, req);
		if (!(await this.roles.canActorManageMember(actor, serverId, targetUserId))) {
			throw new HttpException("Target member's role is at or above yours", 403);
		}
		const [perms, highest, owner] = await Promise.all([
			this.roles.computePermissions(targetUserId, serverId),
			this.roles.highestRolePosition(targetUserId, serverId),
			this.roles.isOwner(targetUserId, serverId)
		]);
		const ref = (await this.roles.findByServer(serverId)) as any[];
		const memberRoles = await this.roles.findMemberRoleIds(targetUserId, serverId);
		const memberRoleIds = new Set(memberRoles.map((id: string) => id));
		let aggAllow = 0n;
		let aggDeny = 0n;
		for (const r of ref) {
			const rid = String(r.id);
			if (r.is_default || memberRoleIds.has(rid)) {
				aggAllow |= BigInt(r.permissions_allow ?? r.permissions ?? '0');
				aggDeny |= BigInt(r.permissions_deny ?? '0');
			}
		}
		const channels = await this.roles.getVisibleChannels(targetUserId, serverId);
		return {
			permissions: perms.toString(),
			permissions_allow: owner ? perms.toString() : aggAllow.toString(),
			permissions_deny: owner ? '0' : aggDeny.toString(),
			highest_role_position: highest,
			is_owner: owner,
			visible_channels: channels
		};
	}

	@Get('servers/:serverId/members/@me/permissions')
	@ApiOperation({ summary: 'Get current user effective permissions' })
	async myPermissions(@Param('serverId') serverId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		const [perms, highest, owner] = await Promise.all([
			this.roles.computePermissions(userId, serverId),
			this.roles.highestRolePosition(userId, serverId),
			this.roles.isOwner(userId, serverId)
		]);
		// permissions_allow / permissions_deny are aggregated separately so the
		// frontend can power read-only views (e.g. show denied flags greyed out)
		// without re-walking the role list. Owner short-circuits to "all bits
		// set in allow, none in deny".
		let aggAllow = 0n;
		let aggDeny = 0n;
		if (!owner) {
			const ref = (await this.roles.findByServer(serverId)) as any[];
			for (const r of ref) {
				aggAllow |= BigInt(r.permissions_allow ?? r.permissions ?? '0');
				aggDeny |= BigInt(r.permissions_deny ?? '0');
			}
		}
		return {
			permissions: perms.toString(),
			permissions_allow: owner ? perms.toString() : aggAllow.toString(),
			permissions_deny: owner ? '0' : aggDeny.toString(),
			highest_role_position: highest,
			is_owner: owner
		};
	}
}
