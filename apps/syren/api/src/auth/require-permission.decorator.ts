import { SetMetadata } from '@nestjs/common';
import { Permissions } from '@syren/types';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

export type PermissionFlagName = keyof typeof Permissions;

/**
 * Marks an HTTP endpoint as requiring a specific permission flag in the
 * server resolved from the route params. Enforced by `PermissionGuard`
 * registered as an APP_GUARD after `AuthGuard` and `ServerAccessGuard`.
 *
 * @example
 *   @RequirePermission('KICK_MEMBERS')
 *   @Delete('servers/:serverId/members/:userId')
 *   kick(...) { ... }
 */
export const RequirePermission = (flag: PermissionFlagName) =>
	SetMetadata(REQUIRE_PERMISSION_KEY, flag);
