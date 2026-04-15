import { Controller, Get, Param, Query, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { RequirePermission } from '../auth/require-permission.decorator';
import type { AuditAction } from '@syren/types';

function parseIntOr(value: string | undefined, fallback: number): number {
	const n = value ? parseInt(value, 10) : NaN;
	return Number.isFinite(n) ? n : fallback;
}

function parseDate(value: string | undefined): Date | undefined {
	if (!value) return undefined;
	const d = new Date(value);
	return isNaN(d.getTime()) ? undefined : d;
}

@ApiTags('audit-log')
@Controller()
export class AuditLogController {
	constructor(private readonly audit: AuditLogService) {}

	@Get('servers/:serverId/audit-log')
	@RequirePermission('VIEW_AUDIT_LOG')
	@ApiOperation({ summary: 'Server-wide audit log (paginated, filterable)' })
	async listForServer(
		@Param('serverId') serverId: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('action') action?: string,
		@Query('actor_id') actorId?: string,
		@Query('target_user_id') targetUserId?: string,
		@Query('since') since?: string,
		@Query('until') until?: string,
		@Query('q') q?: string
	) {
		return this.audit.listForServer(serverId, {
			limit: parseIntOr(limit, 50),
			offset: parseIntOr(offset, 0),
			action: action as AuditAction | undefined,
			actor_id: actorId,
			target_user_id: targetUserId,
			since: parseDate(since),
			until: parseDate(until),
			q
		});
	}

	@Get('servers/:serverId/members/:userId/audit-log')
	@RequirePermission('VIEW_AUDIT_LOG')
	@ApiOperation({ summary: 'Audit log filtered to a single user (paginated)' })
	async listForUser(
		@Param('serverId') serverId: string,
		@Param('userId') userId: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string,
		@Query('action') action?: string,
		@Query('q') q?: string
	) {
		return this.audit.listForUser(serverId, userId, {
			limit: parseIntOr(limit, 50),
			offset: parseIntOr(offset, 0),
			action: action as AuditAction | undefined,
			q
		});
	}
}
