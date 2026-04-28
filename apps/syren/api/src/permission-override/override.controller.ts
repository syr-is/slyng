import { Controller, Get, Put, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OverrideService } from './override.service';
import { UpsertOverrideDto } from '../dto';

@ApiTags('permission-overrides')
@Controller()
export class OverrideController {
	constructor(private readonly overrides: OverrideService) {}

	@Get('servers/:serverId/overrides')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'List all permission overrides for a server' })
	async list(@Param('serverId') serverId: string) {
		return this.overrides.listForServer(serverId);
	}

	@Get('servers/:serverId/overrides/channel/:channelId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'List overrides for a specific channel' })
	async forChannel(
		@Param('serverId') serverId: string,
		@Param('channelId') channelId: string
	) {
		return this.overrides.listForScope(serverId, 'channel', channelId);
	}

	@Get('servers/:serverId/overrides/category/:categoryId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'List overrides for a specific category' })
	async forCategory(
		@Param('serverId') serverId: string,
		@Param('categoryId') categoryId: string
	) {
		return this.overrides.listForScope(serverId, 'category', categoryId);
	}

	@Put('servers/:serverId/overrides')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Upsert a permission override' })
	async upsert(
		@Param('serverId') serverId: string,
		@Body() body: UpsertOverrideDto,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			return await this.overrides.upsert(serverId, actor, {
				...body,
				scope_id: body.scope_id ?? null
			});
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('servers/:serverId/overrides/:overrideId')
	@RequirePermission('MANAGE_ROLES')
	@ApiOperation({ summary: 'Remove a permission override' })
	async remove(
		@Param('serverId') serverId: string,
		@Param('overrideId') overrideId: string,
		@Req() req: any
	) {
		const actor = req.user?.id;
		if (!actor) throw new HttpException('Unauthorized', 401);
		try {
			await this.overrides.remove(serverId, actor, overrideId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}
}
