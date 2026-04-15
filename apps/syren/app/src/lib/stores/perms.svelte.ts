/**
 * Effective permissions for the currently-active server.
 * Loaded from `/api/servers/:id/members/@me/permissions` when entering a server.
 *
 * Owner gets ADMINISTRATOR (bit 30) — short-circuits all checks.
 */

import { Permissions, hasPermission } from '@syren/types';

let activeServerId = $state<string | null>(null);
let bitmask = $state<bigint>(0n);

export function getPerms() {
	return {
		get serverId() {
			return activeServerId;
		},
		get bits() {
			return bitmask;
		},
		can(flag: bigint): boolean {
			return hasPermission(bitmask, flag);
		},
		get isAdmin(): boolean {
			return (bitmask & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR;
		},
		// Convenience flags — keep names short, use in templates
		get canManageServer() {
			return hasPermission(bitmask, Permissions.MANAGE_SERVER);
		},
		get canManageChannels() {
			return hasPermission(bitmask, Permissions.MANAGE_CHANNELS);
		},
		get canManageRoles() {
			return hasPermission(bitmask, Permissions.MANAGE_ROLES);
		},
		get canManageMessages() {
			return hasPermission(bitmask, Permissions.MANAGE_MESSAGES);
		},
		get canCreateInvites() {
			return hasPermission(bitmask, Permissions.CREATE_INVITES);
		},
		get canManageInvites() {
			return hasPermission(bitmask, Permissions.MANAGE_INVITES);
		},
		get canKick() {
			return hasPermission(bitmask, Permissions.KICK_MEMBERS);
		},
		get canBan() {
			return hasPermission(bitmask, Permissions.BAN_MEMBERS);
		},
		get canViewAuditLog() {
			return hasPermission(bitmask, Permissions.VIEW_AUDIT_LOG);
		},
		get canViewRemovedMessages() {
			return hasPermission(bitmask, Permissions.VIEW_REMOVED_MESSAGES);
		}
	};
}

export function setServerPerms(serverId: string | null, permissionsString: string) {
	activeServerId = serverId;
	bitmask = BigInt(permissionsString || '0');
}

export function clearServerPerms() {
	activeServerId = null;
	bitmask = 0n;
}
