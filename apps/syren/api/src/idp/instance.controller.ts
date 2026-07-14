import { Body, Controller, Get, Header, HttpException, Param, Patch, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { InstanceLimitsPatchDto } from '../dto';
import { LocalAccountRepository } from './idp.repository';
import { InstanceConfigService } from './instance-config.service';
import { InstanceAdminService } from './instance-admin.service';

/**
 * Instance-level control surface. The current upload limits are public (clients
 * read the per-file cap to validate before presigning, and show the storage
 * quota); changing them requires an instance admin (`local_account.role ===
 * 'ADMIN'`). `GET /api/instance/admin` lets the UI decide whether to show the
 * admin controls.
 */
@ApiTags('idp')
@Controller('instance')
export class InstanceController {
	constructor(
		private readonly instanceConfig: InstanceConfigService,
		private readonly accounts: LocalAccountRepository,
		private readonly admin: InstanceAdminService,
		private readonly config: ConfigService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	private async assertAdmin(req: Request): Promise<void> {
		const did = this.requireDid(req);
		if (!(await this.isAdmin(did))) throw new HttpException('Instance admin only', 403);
	}

	private clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
		const n = raw !== undefined ? parseInt(raw, 10) : NaN;
		if (Number.isNaN(n)) return fallback;
		return Math.min(hi, Math.max(lo, n));
	}

	/**
	 * An account is an instance admin if its `local_account.role` is `ADMIN`, or
	 * its username is listed in `SYREN_ADMIN_USERNAMES` (comma-separated). The env
	 * list is the bootstrap so the operator can grant themselves admin without a
	 * DB edit; role-based admins are for a future admin-management UI.
	 *
	 * `findByDid` only ever resolves a **local** account (federated users have no
	 * `local_account` row), and DIDs are unique — so a same-username user from
	 * another instance can never match here. The username comparison is
	 * **case-sensitive** on purpose: usernames are case-sensitively unique, so an
	 * exact match resolves to exactly one account; a lowercased match would let a
	 * case-variant registration (e.g. "Alice" against an admin "alice") escalate.
	 */
	private async isAdmin(did: string): Promise<boolean> {
		const acct = await this.accounts.findByDid(did);
		if (!acct) return false;
		if (acct.role === 'ADMIN') return true;
		const envAdmins = (this.config.get<string>('SYREN_ADMIN_USERNAMES', '') || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		return envAdmins.includes(acct.username);
	}

	@Public()
	@Get('limits')
	@Header('Cache-Control', 'public, max-age=30')
	@ApiOperation({ summary: 'Current instance upload limits (per-file cap + storage quota)' })
	async limits() {
		return { status: 'success', data: await this.instanceConfig.getLimits() };
	}

	@SkipServerAccess()
	@Get('admin')
	@ApiOperation({ summary: 'Whether the caller is an instance admin' })
	async adminStatus(@Req() req: Request) {
		const did = this.requireDid(req);
		return { status: 'success', data: { is_admin: await this.isAdmin(did) } };
	}

	@SkipServerAccess()
	@Patch('limits')
	@ApiOperation({ summary: 'Update instance upload limits (admin only)' })
	async setLimits(@Req() req: Request, @Body() body: InstanceLimitsPatchDto) {
		await this.assertAdmin(req);
		if (body.max_file_size_mb !== undefined) {
			await this.instanceConfig.setMaxFileSizeMb(body.max_file_size_mb);
		}
		if (body.storage_limit_gb !== undefined) {
			await this.instanceConfig.setStorageLimitGb(body.storage_limit_gb);
		}
		return { status: 'success', data: await this.instanceConfig.getLimits() };
	}

	@SkipServerAccess()
	@Get('users')
	@ApiOperation({ summary: 'Paginated local users with storage use (admin only)' })
	async users(
		@Req() req: Request,
		@Query('q') q?: string,
		@Query('role') role?: string,
		@Query('sort') sort?: string,
		@Query('order') order?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		await this.assertAdmin(req);
		const data = await this.admin.listUsers({
			q: q || undefined,
			role: role === 'ADMIN' || role === 'USER' ? role : undefined,
			sort: sort || undefined,
			order: order === 'asc' ? 'asc' : 'desc',
			limit: this.clampInt(limit, 25, 1, 100),
			offset: Math.max(0, this.clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER))
		});
		return { status: 'success', ...data };
	}

	@SkipServerAccess()
	@Get('users/:did/files')
	@ApiOperation({ summary: "Browse a user's library files (admin only)" })
	async userFiles(
		@Req() req: Request,
		@Param('did') did: string,
		@Query('search') search?: string,
		@Query('sort') sort?: string,
		@Query('order') order?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		await this.assertAdmin(req);
		const data = await this.admin.listUserFiles(decodeURIComponent(did), {
			search: search || undefined,
			sort: sort || undefined,
			order: order === 'asc' ? 'asc' : 'desc',
			limit: this.clampInt(limit, 25, 1, 100),
			offset: Math.max(0, this.clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER))
		});
		return { status: 'success', ...data };
	}
}
