import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PaginatedQuery, type DateRangeOptions, type PaginationOptions } from '../common/pagination';
import type { AuditAction } from '@syren/types';

@ApiTags('audit-log')
@Controller()
export class AuditLogController {
	constructor(private readonly audit: AuditLogService) {}

	@Get('servers/:serverId/audit-log')
	@RequirePermission('VIEW_AUDIT_LOG')
	@ApiOperation({ summary: 'Server-wide audit log (paginated, filterable)' })
	async listForServer(
		@Param('serverId') serverId: string,
		@PaginatedQuery({ dateRange: true }) p: DateRangeOptions,
		@Query('action') action?: string,
		@Query('actor_id') actorId?: string,
		@Query('target_user_id') targetUserId?: string,
		@Query('channel_id') channelId?: string,
		@Req() req?: any
	) {
		return this.audit.listForServer(
			serverId,
			{
				...p,
				action: action as AuditAction | undefined,
				actor_id: actorId,
				target_user_id: targetUserId,
				channel_id: channelId
			},
			req?.user?.id
		);
	}

	@Get('servers/:serverId/members/:userId/audit-log')
	@RequirePermission('VIEW_AUDIT_LOG')
	@ApiOperation({ summary: 'Audit log filtered to a single user (paginated)' })
	async listForUser(
		@Param('serverId') serverId: string,
		@Param('userId') userId: string,
		@PaginatedQuery() p: PaginationOptions,
		@Query('action') action?: string,
		@Req() req?: any
	) {
		return this.audit.listForUser(
			serverId,
			userId,
			{ ...p, action: action as AuditAction | undefined },
			req?.user?.id
		);
	}
}
