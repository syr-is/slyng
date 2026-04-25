/**
 * Effective permissions + role hierarchy for the currently-active server.
 * Loaded from `/api/servers/:id/members/@me/permissions` when entering a
 * server, refetched live whenever the actor's own roles or any role's
 * position changes (debounced).
 */

import { Permissions, WsOp, hasPermission } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { getAuth } from './auth.svelte';
import { getServerState } from './servers.svelte';
import { getMembers } from './members.svelte';
import { getRoles } from './roles.svelte';
import { api } from '../api';

let activeServerId = $state<string | null>(null);
let bitmask = $state<bigint>(0n);
let highestRolePosition = $state<number>(0);
let isOwnerFlag = $state<boolean>(false);

/**
 * Owner check that doesn't depend on the `/me/permissions` response. Compares
 * the current user's DID to the active server's `owner_id` already loaded by
 * the layout. Used as a belt-and-suspenders fallback so a stale backend or a
 * dropped field never strands the actual owner with a non-owner UI.
 */
function isActuallyOwner(): boolean {
	const auth = getAuth();
	const ownerId = getServerState().activeServerOwnerId;
	return !!ownerId && ownerId === auth.identity?.did;
}

/**
 * Compute the actor's highest role position from the local stores. More
 * reliable than trusting the `/me/permissions` snapshot because:
 *  - The members/roles stores update in real time via MEMBER_UPDATE / ROLE_*
 *    WS events; backend snapshots are at-most-150ms-stale via the debounced
 *    refetch.
 *  - If the backend is on an older build that doesn't send
 *    `highest_role_position`, this still works.
 *
 * Returns 0 when the user has no roles or only @everyone.
 */
function clientHighestRolePosition(): number {
	const auth = getAuth();
	const did = auth.identity?.did;
	if (!did) return 0;
	const me = getMembers().list.find((m) => m.user_id === did);
	const roleIds = me?.role_ids ?? [];
	if (!roleIds.length) return 0;
	const ids = new Set(roleIds.map((r) => (typeof r === 'string' ? r : (r as any)?.id ?? '')));
	const roles = getRoles().list;
	return roles
		.filter((r) => ids.has(r.id))
		.reduce((max, r) => Math.max(max, r.position ?? 0), 0);
}

/**
 * Source of truth for the actor's highest position: max of
 *   - the backend snapshot (`highestRolePosition` state)
 *   - the live client computation (`clientHighestRolePosition()`)
 * Owner short-circuits to MAX_SAFE_INTEGER. Taking the max means we're never
 * artificially restricted by a stale value.
 */
function effectiveHighest(): number {
	if (isOwnerFlag || isActuallyOwner()) return Number.MAX_SAFE_INTEGER;
	return Math.max(highestRolePosition, clientHighestRolePosition());
}

interface RoleLike {
	id?: string;
	position?: number;
	is_default?: boolean;
}

interface MemberLike {
	user_id: string;
	role_ids?: Array<string | { id: string }>;
}

export function getPerms() {
	return {
		get serverId() {
			return activeServerId;
		},
		get bits() {
			return bitmask;
		},
		get highestRolePosition() {
			return effectiveHighest();
		},
		get isOwner() {
			return isOwnerFlag || isActuallyOwner();
		},
		can(flag: bigint): boolean {
			return hasPermission(bitmask, flag);
		},
		get isAdmin(): boolean {
			return (bitmask & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR;
		},
		// Hierarchy gates — used by UI to disable buttons before the user clicks.
		canManageRole(role: RoleLike | null | undefined): boolean {
			if (!role) return false;
			if (isOwnerFlag || isActuallyOwner()) return true;
			return (role.position ?? 0) < effectiveHighest();
		},
		canAssignRole(role: RoleLike | null | undefined): boolean {
			return this.canManageRole(role);
		},
		/** True iff the role is exactly at the actor's highest position (i.e. one of their own top roles). */
		isMyHighestRole(role: RoleLike | null | undefined): boolean {
			if (!role || role.is_default) return false;
			if (isOwnerFlag || isActuallyOwner()) return false;
			const top = effectiveHighest();
			return (role.position ?? 0) === top && top > 0;
		},
		/** Pass the target member + the full server roles list. */
		canManageMember(target: MemberLike | null | undefined, allRoles: RoleLike[] = []): boolean {
			if (!target) return false;
			const auth = getAuth();
			if (target.user_id === auth.identity?.did) return true; // self
			if (isOwnerFlag || isActuallyOwner()) return true;
			const targetRoleIds = new Set(
				(target.role_ids ?? []).map((r) => (typeof r === 'string' ? r : r?.id ?? ''))
			);
			const targetHighest = allRoles
				.filter((r) => r.id && targetRoleIds.has(r.id))
				.reduce((max, r) => Math.max(max, r.position ?? 0), 0);
			return effectiveHighest() > targetHighest;
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
		},
		get canViewTrash() {
			return hasPermission(bitmask, Permissions.VIEW_TRASH);
		},
		get canHardDelete() {
			return hasPermission(bitmask, Permissions.HARD_DELETE);
		},
		canInChannel(channelId: string, flag: bigint): boolean {
			const ch = getServerState().channels.find((c) => c.id === channelId);
			if (!ch?.my_permissions) return this.can(flag);
			return hasPermission(BigInt(ch.my_permissions), flag);
		}
	};
}

export function setServerPerms(
	serverId: string | null,
	permissionsString: string,
	hierarchy?: { highest_role_position: number; is_owner: boolean }
) {
	activeServerId = serverId;
	bitmask = BigInt(permissionsString || '0');
	highestRolePosition = hierarchy?.highest_role_position ?? 0;
	isOwnerFlag = hierarchy?.is_owner ?? false;
}

export function clearServerPerms() {
	activeServerId = null;
	bitmask = 0n;
	highestRolePosition = 0;
	isOwnerFlag = false;
}

// ── Reactive refetch ──
//
// The actor's effective perms can shift without a page reload:
//   - Someone assigns/unassigns them a role  → MEMBER_UPDATE for self
//   - A role they hold has its perms edited  → ROLE_UPDATE
//   - A role they hold is moved up/down       → ROLE_UPDATE (position diff)
//   - A role they hold is soft-deleted        → ROLE_DELETE
//   - A role they used to have is restored    → ROLE_CREATE (re-broadcast)
// In any of those cases, refetch /me/permissions and recompute. Debounced
// so a burst of role changes only fires one HTTP request.

let refetchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefetch() {
	if (!activeServerId) return;
	const sid = activeServerId;
	if (refetchTimer) clearTimeout(refetchTimer);
	refetchTimer = setTimeout(async () => {
		refetchTimer = null;
		if (activeServerId !== sid) return; // user switched servers
		try {
			const p = await api.roles.myPermissions(sid);
			if (activeServerId !== sid) return;
			setServerPerms(sid, p.permissions || '0', {
				highest_role_position: p.highest_role_position ?? 0,
				is_owner: !!p.is_owner
			});
		} catch {
			// best-effort; existing perms stay until the next event
		}
	}, 150);
}

onWsEvent(WsOp.MEMBER_UPDATE, (data) => {
	const auth = getAuth();
	const me = auth.identity?.did;
	if (me && (data as { user_id?: string })?.user_id === me) scheduleRefetch();
});
onWsEvent(WsOp.ROLE_UPDATE, () => scheduleRefetch());
onWsEvent(WsOp.ROLE_CREATE, () => scheduleRefetch());
onWsEvent(WsOp.ROLE_DELETE, () => scheduleRefetch());
