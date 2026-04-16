import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permissions } from '@syren/types';
import { RoleService } from '../role/role.service';
import { MemberAccessService } from './member-access.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_SERVER_ACCESS_KEY } from './server-access.decorator';
import {
	REQUIRE_PERMISSION_KEY,
	type PermissionFlagName
} from './require-permission.decorator';

/**
 * Route-level permission enforcement. Runs after `AuthGuard` (which populates
 * `req.user`) and `ServerAccessGuard` (which blocks banned / non-member
 * users). This guard only runs when a route carries `@RequirePermission(flag)`.
 *
 * Moving enforcement to the boundary gives us one place to audit all
 * permissioned endpoints instead of chasing `roleService.requirePermission`
 * calls through every service method.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly roleService: RoleService,
		private readonly access: MemberAccessService
	) {}

	async canActivate(ctx: ExecutionContext): Promise<boolean> {
		// Public endpoints bypass entirely
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			ctx.getHandler(),
			ctx.getClass()
		]);
		if (isPublic) return true;

		// Routes that opt out of server-scoped guards (pre-membership flows)
		const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SERVER_ACCESS_KEY, [
			ctx.getHandler(),
			ctx.getClass()
		]);
		if (skip) return true;

		const flagName = this.reflector.getAllAndOverride<PermissionFlagName>(
			REQUIRE_PERMISSION_KEY,
			[ctx.getHandler(), ctx.getClass()]
		);
		if (!flagName) return true; // no permission required

		const req = ctx.switchToHttp().getRequest();
		const userId = req?.user?.id;
		if (!userId) throw new ForbiddenException('Unauthorized');

		const serverId = await this.access.resolveRouteServerId(req);
		if (!serverId) {
			// DM channels and other non-server-scoped routes pass through —
			// permission overrides only apply within servers.
			return true;
		}

		// Resolve channel context from route params so channel/category
		// overrides are applied automatically for channel-scoped routes.
		const params = req?.params ?? {};
		const channelId: string | undefined = params.channelId;

		const flag = Permissions[flagName];
		const ok = await this.roleService.hasPermission(userId, serverId, flag, channelId);
		if (!ok) throw new ForbiddenException(`${flagName} required`);
		return true;
	}
}
