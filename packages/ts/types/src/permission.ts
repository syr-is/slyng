/**
 * Permission bit flags for server roles.
 * Stored as BigInt string in DB, computed with bitwise ops.
 */

// ── Permission flags ──

export const Permissions = {
	SEND_MESSAGES: 1n << 0n,
	READ_MESSAGES: 1n << 1n,
	MANAGE_MESSAGES: 1n << 2n, // delete/pin others' messages
	EMBED_LINKS: 1n << 3n,
	ATTACH_FILES: 1n << 4n,
	ADD_REACTIONS: 1n << 5n,
	MENTION_EVERYONE: 1n << 6n,

	CONNECT: 1n << 10n, // join voice
	SPEAK: 1n << 11n,
	MUTE_MEMBERS: 1n << 12n,
	DEAFEN_MEMBERS: 1n << 13n,

	MANAGE_CHANNELS: 1n << 20n,
	MANAGE_ROLES: 1n << 21n,
	MANAGE_SERVER: 1n << 22n,
	CREATE_INVITES: 1n << 23n,
	KICK_MEMBERS: 1n << 24n,
	BAN_MEMBERS: 1n << 25n,
	MANAGE_INVITES: 1n << 26n, // list + revoke any invite (creator can always revoke their own)
	VIEW_REMOVED_MESSAGES: 1n << 27n, // read content of soft-deleted messages
	VIEW_AUDIT_LOG: 1n << 28n, // read the server audit log
	VIEW_TRASH: 1n << 29n, // browse trashed channels/roles/messages and restore

	ADMINISTRATOR: 1n << 30n, // bypasses all permission checks

	HARD_DELETE: 1n << 31n // irreversibly purge a trashed item
} as const;

// ── Default permission sets ──

export const DEFAULT_PERMISSIONS =
	Permissions.SEND_MESSAGES |
	Permissions.READ_MESSAGES |
	Permissions.EMBED_LINKS |
	Permissions.ATTACH_FILES |
	Permissions.ADD_REACTIONS |
	Permissions.CONNECT |
	Permissions.SPEAK |
	Permissions.CREATE_INVITES;

export const ALL_PERMISSIONS = Object.values(Permissions).reduce((a, b) => a | b, 0n);

// ── Utilities ──

export function hasPermission(permissions: bigint | string, flag: bigint): boolean {
	const p = typeof permissions === 'string' ? BigInt(permissions) : permissions;
	if (p & Permissions.ADMINISTRATOR) return true;
	return (p & flag) === flag;
}

export function addPermission(permissions: bigint | string, flag: bigint): string {
	const p = typeof permissions === 'string' ? BigInt(permissions) : permissions;
	return (p | flag).toString();
}

export function removePermission(permissions: bigint | string, flag: bigint): string {
	const p = typeof permissions === 'string' ? BigInt(permissions) : permissions;
	return (p & ~flag).toString();
}

// ── Permission overrides ──

import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const PermissionScopeTypeSchema = z.enum(['server', 'category', 'channel']);
export type PermissionScopeType = z.infer<typeof PermissionScopeTypeSchema>;

export const PermissionTargetTypeSchema = z.enum(['role', 'user']);
export type PermissionTargetType = z.infer<typeof PermissionTargetTypeSchema>;

export const PermissionOverrideSchema = BaseEntitySchema.extend({
	server_id: z.string(),
	scope_type: PermissionScopeTypeSchema,
	scope_id: z.string().nullable(),
	target_type: PermissionTargetTypeSchema,
	target_id: z.string(),
	allow: z.string().default('0'),
	deny: z.string().default('0')
});
export type PermissionOverride = z.infer<typeof PermissionOverrideSchema>;
