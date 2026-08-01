import {
	Injectable,
	Inject,
	Optional,
	Logger,
	ForbiddenException,
	NotFoundException,
	forwardRef
} from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, hasPermission, stringToRecordId } from '@slyng/types';
import { ServerRepository, ServerMemberRepository, ServerRoleRepository } from '../server/server.repository';
import { PermissionOverrideRepository } from '../permission-override/override.repository';
import {
	ChannelRepository,
	ChannelCategoryRepository,
	type ChannelRow
} from '../channel/channel.repository';
import { ChatGateway } from '../gateway/chat.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
	constantPermissionFold,
	resolvePermissionFold,
	type PermissionFold
} from '../common/permission-fold';

/**
 * Shape of `buildPermissionTree`. Exported because consumers (channel listing,
 * message search, the mention inbox) filter on `can_view` and previously had to
 * cast every node to `any` to reach it.
 *
 * `permissions` is a decimal string, not a bigint — it crosses the wire.
 */
export interface PermissionTreeChannel {
	id: string;
	name: string;
	type: string;
	position: number;
	permissions: string;
	/** READ_MESSAGES resolved for this actor on this channel. */
	can_view: boolean;
}

export interface PermissionTreeCategory {
	id: string;
	name: string;
	position: number;
	permissions: string;
	channels: PermissionTreeChannel[];
}

export interface PermissionTree {
	server: { permissions: string };
	categories: PermissionTreeCategory[];
	uncategorized: PermissionTreeChannel[];
}

@Injectable()
export class RoleService {
	private readonly logger = new Logger(RoleService.name);

	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly roles: ServerRoleRepository,
		private readonly permOverrides: PermissionOverrideRepository,
		// Permission resolution walks the channel/category tree, so it reads
		// those tables through their own repositories rather than borrowing the
		// role repository's connection.
		private readonly channels: ChannelRepository,
		private readonly categories: ChannelCategoryRepository,
		@Inject(forwardRef(() => AuditLogService))
		private readonly audit: AuditLogService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async findByServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		return this.roles.findMany(
			{ server_id: ref, deleted: false },
			{ sort: { field: 'position', order: 'asc' } }
		);
	}

	/** Public read path: hides soft-deleted roles. Use `findByIdRaw` for trash flows. */
	async findById(roleId: string) {
		const r = await this.roles.findById(roleId);
		if (!r || r.deleted) return null;
		return r;
	}

	async findRoleById(roleId: string) {
		return this.roles.findById(roleId);
	}

	async findByIdRaw(roleId: string) {
		return this.roles.findById(roleId);
	}

	async listTrashedForServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		const rows = await this.roles.findMany(
			{ server_id: ref, deleted: true },
			{ sort: { field: 'deleted_at', order: 'desc' } }
		);
		// Enrich with member_count so the UI can show how many will get the role back
		const enriched = await Promise.all(
			rows.map(async (r) => {
				const ridRef = r.id as RecordId;
				const ridEnc = stringToRecordId.encode(ridRef);
				const allMembers = await this.members.findMany({ server_id: ref });
				const member_count = allMembers.filter((m) => {
					const ids = (m.role_ids ?? []) as RecordId[];
					return ids.some((x) => stringToRecordId.encode(x) === ridEnc);
				}).length;
				return { ...(r as any), member_count };
			})
		);
		return enriched;
	}

	async create(
		serverId: string,
		userId: string,
		data: {
			name: string;
			color?: string | null;
			permissions?: string;
			permissions_allow?: string;
			permissions_deny?: string;
		}
	) {
		const ref = stringToRecordId.decode(serverId);
		const now = new Date();

		// New roles always spawn one slot above @everyone so they can never
		// land above the actor's hierarchy. Owner can move them up later via
		// swapPositions; non-owners are still bound by their highest.
		//
		// Strategy:
		//   - @everyone is pinned at position 0.
		//   - Find the lowest non-default position currently in use.
		//   - If no custom roles exist → new role at position 1.
		//   - If lowest > 1 → take lowest - 1 (no shifting needed; sparse range).
		//   - If lowest === 1 → bump every custom role's position by 1 sequentially
		//     (deterministic order — high-to-low so we never collide while moving),
		//     then place the new role at position 1.
		const existing = await this.roles.findMany({ server_id: ref });
		const customRoles = existing
			.filter((r) => !r.is_default && !r.deleted)
			.sort(
				(a, b) => ((b.position as number) ?? 0) - ((a.position as number) ?? 0)
			);
		let position: number;
		if (customRoles.length === 0) {
			position = 1;
		} else {
			const lowest = ((customRoles[customRoles.length - 1] as any).position as number) ?? 0;
			if (lowest > 1) {
				position = lowest - 1;
			} else {
				// Sequential high-to-low bump avoids transient position collisions.
				for (const r of customRoles) {
					const id = stringToRecordId.encode(r.id as RecordId);
					const next = ((r.position as number) ?? 0) + 1;
					await this.roles.merge(id, { position: next, updated_at: now });
					const bumped = await this.roles.findById(id);
					this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: bumped });
				}
				position = 1;
			}
		}

		// Permission-grant cap: actor can only flip bits they themselves hold.
		const allow = BigInt(data.permissions_allow ?? data.permissions ?? '0');
		const deny = BigInt(data.permissions_deny ?? '0');
		const isOwner = await this.isOwner(userId, serverId);
		if (!isOwner) {
			const actorPerms = await this.computePermissions(userId, serverId);
			if (!this.canActorEditPerms(actorPerms, 0n, 0n, allow, deny)) {
				throw new ForbiddenException('You can only grant permissions you yourself hold');
			}
		}

		const role = await this.roles.create({
			server_id: ref,
			name: data.name,
			color: data.color ?? null,
			permissions: allow.toString(),
			permissions_allow: allow.toString(),
			permissions_deny: deny.toString(),
			position,
			is_default: false,
			deleted: false,
			created_at: now,
			updated_at: now
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_CREATE, d: role });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'role_create',
			targetKind: 'role',
			targetId: stringToRecordId.encode(role.id),
			metadata: {
				name: data.name,
				color: data.color ?? null,
				permissions_allow: allow.toString(),
				permissions_deny: deny.toString()
			}
		});
		this.logger.log(`Role created: ${role.id}`);
		return role;
	}

	async update(
		roleId: string,
		userId: string,
		data: {
			name?: string;
			color?: string | null;
			permissions?: string;
			permissions_allow?: string;
			permissions_deny?: string;
			position?: number;
		}
	) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		const serverId = stringToRecordId.encode(role.server_id);

		// Hierarchy: actor must outrank the role they're editing.
		if (!(await this.canActorManageRole(userId, serverId, role))) {
			throw new ForbiddenException('You cannot manage roles at or above your highest role');
		}
		if (role.is_default && data.name !== undefined) {
			throw new ForbiddenException('Cannot rename the default role');
		}
		// Position is managed exclusively via swapPositions.
		if (data.position !== undefined) {
			throw new ForbiddenException('Use swapPositions to move roles');
		}

		// Permission-grant cap.
		const oldAllow = BigInt((role.permissions_allow as string) ?? (role.permissions as string) ?? '0');
		const oldDeny = BigInt((role.permissions_deny as string) ?? '0');
		const newAllow =
			data.permissions_allow !== undefined
				? BigInt(data.permissions_allow)
				: data.permissions !== undefined
					? BigInt(data.permissions)
					: oldAllow;
		const newDeny = data.permissions_deny !== undefined ? BigInt(data.permissions_deny) : oldDeny;

		const isOwner = await this.isOwner(userId, serverId);
		if (!isOwner) {
			const actorPerms = await this.computePermissions(userId, serverId);
			if (!this.canActorEditPerms(actorPerms, oldAllow, oldDeny, newAllow, newDeny)) {
				throw new ForbiddenException('You can only flip permissions you yourself hold');
			}
		}

		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.color !== undefined) merge.color = data.color;
		if (newAllow !== oldAllow) {
			merge.permissions_allow = newAllow.toString();
			merge.permissions = newAllow.toString(); // keep legacy field in sync
		}
		if (newDeny !== oldDeny) merge.permissions_deny = newDeny.toString();

		const updated = await this.roles.merge(roleId, merge);
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updated });

		// Audit metadata calls out allow/deny diffs separately so reviewers
		// can tell what was granted vs revoked at a glance.
		const changes: Record<string, unknown> = {};
		if (data.name !== undefined && data.name !== role.name) changes.name = data.name;
		if (data.color !== undefined && data.color !== role.color) changes.color = data.color;
		if (newAllow !== oldAllow)
			changes.permissions_allow = { from: oldAllow.toString(), to: newAllow.toString() };
		if (newDeny !== oldDeny)
			changes.permissions_deny = { from: oldDeny.toString(), to: newDeny.toString() };
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'role_update',
			targetKind: 'role',
			targetId: roleId,
			metadata: { changes, name: role.name }
		});
		return updated;
	}

	/**
	 * Swap positions of two roles in the same server. Used by the hierarchy
	 * up/down arrows in the UI. Hierarchy: actor must outrank both roles AND
	 * the highest post-swap position must remain strictly below actor's.
	 */
	async swapPositions(roleAId: string, roleBId: string, userId: string) {
		const a = await this.roles.findById(roleAId);
		const b = await this.roles.findById(roleBId);
		if (!a || !b) throw new NotFoundException('Role not found');
		if (stringToRecordId.encode(a.server_id) !== stringToRecordId.encode(b.server_id)) {
			throw new ForbiddenException('Roles belong to different servers');
		}
		if (a.is_default || b.is_default) {
			throw new ForbiddenException('Cannot move the default role');
		}
		const serverId = stringToRecordId.encode(a.server_id);
		const posA = a.position as number;
		const posB = b.position as number;

		const isOwner = await this.isOwner(userId, serverId);
		if (!isOwner) {
			const actorPos = await this.highestRolePosition(userId, serverId);
			// Actor must outrank the higher of the two post-swap positions
			// (which equals the current higher position — swap is a permutation).
			const maxAfter = Math.max(posA, posB);
			if (actorPos <= maxAfter) {
				throw new ForbiddenException('You cannot move roles at or above your highest role');
			}
		}

		const updatedA = await this.roles.merge(roleAId, { position: posB, updated_at: new Date() });
		const updatedB = await this.roles.merge(roleBId, { position: posA, updated_at: new Date() });
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updatedA });
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updatedB });

		// Audit each leg so the position history is reconstructable.
		await Promise.all([
			this.audit.record({
				serverId,
				actorId: userId,
				action: 'role_update',
				targetKind: 'role',
				targetId: roleAId,
				metadata: {
					changes: { position: { from: posA, to: posB } },
					name: a.name
				}
			}),
			this.audit.record({
				serverId,
				actorId: userId,
				action: 'role_update',
				targetKind: 'role',
				targetId: roleBId,
				metadata: {
					changes: { position: { from: posB, to: posA } },
					name: b.name
				}
			})
		]);
		return { a: updatedA, b: updatedB };
	}

	async reorder(serverId: string, roleIds: string[], userId: string) {
		if (roleIds.length < 2) return { updated: 0 };

		const allRoles = (await this.findByServer(serverId)) as any[];
		const roleMap = new Map(allRoles.map((r) => [stringToRecordId.encode(r.id), r]));

		const toReorder: any[] = [];
		for (const id of roleIds) {
			const role = roleMap.get(id);
			if (!role) throw new NotFoundException('Role not found');
			if (role.is_default) throw new ForbiddenException('Cannot reorder the default role');
			toReorder.push(role);
		}

		const isOwner = await this.isOwner(userId, serverId);
		if (!isOwner) {
			const actorPos = await this.highestRolePosition(userId, serverId);
			for (const role of toReorder) {
				if ((role.position as number) >= actorPos) {
					throw new ForbiddenException('Cannot reorder roles at or above your highest role');
				}
			}
		}

		const positions = toReorder.map((r) => r.position as number).sort((a, b) => b - a);

		const updates: { role: any; oldPos: number; newPos: number }[] = [];
		for (let i = 0; i < toReorder.length; i++) {
			if (toReorder[i].position !== positions[i]) {
				updates.push({ role: toReorder[i], oldPos: toReorder[i].position, newPos: positions[i] });
			}
		}

		if (!updates.length) return { updated: 0 };

		for (const { role, oldPos, newPos } of updates) {
			const roleId = stringToRecordId.encode(role.id);
			const updated = await this.roles.merge(roleId, { position: newPos, updated_at: new Date() });
			this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updated });
			await this.audit.record({
				serverId,
				actorId: userId,
				action: 'role_update',
				targetKind: 'role',
				targetId: roleId,
				metadata: {
					changes: { position: { from: oldPos, to: newPos } },
					name: role.name
				}
			});
		}

		return { updated: updates.length };
	}

	async delete(roleId: string, userId: string) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		if (role.is_default) throw new ForbiddenException('Cannot delete the default role');
		if (role.deleted) throw new ForbiddenException('Role already in trash');

		const serverId = stringToRecordId.encode(role.server_id);
		if (!(await this.canActorManageRole(userId, serverId, role))) {
			throw new ForbiddenException('You cannot manage roles at or above your highest role');
		}
		const now = new Date();
		// Soft-delete: keep the row + every member's role_ids array intact so
		// restore is a single merge. Permissions stop applying because
		// computePermissions filters out soft-deleted roles.
		await this.roles.merge(roleId, {
			deleted: true,
			deleted_at: now,
			deleted_by: userId,
			updated_at: now
		});
		this.gateway?.emitToServer(serverId, {
			op: WsOp.ROLE_DELETE,
			d: { id: roleId, server_id: serverId }
		});
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'role_delete',
			targetKind: 'role',
			targetId: roleId,
			metadata: { name: role.name, color: role.color ?? null }
		});
		this.logger.log(`Role soft-deleted: ${roleId}`);
	}

	async restore(roleId: string, userId: string) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		if (!role.deleted) throw new ForbiddenException('Role is not in trash');
		const serverId = stringToRecordId.encode(role.server_id);
		if (!(await this.canActorManageRole(userId, serverId, role))) {
			throw new ForbiddenException('You cannot restore roles at or above your highest role');
		}
		await this.roles.merge(roleId, {
			deleted: false,
			deleted_at: null,
			deleted_by: null,
			updated_at: new Date()
		});
		const restored = await this.roles.findById(roleId);
		// Re-broadcast as ROLE_CREATE so clients re-add it to the role list.
		// Members who still hold it in role_ids regain perms automatically via
		// computePermissions (the deleted filter no longer excludes the row).
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_CREATE, d: restored });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'role_restore',
			targetKind: 'role',
			targetId: roleId,
			metadata: { name: role.name, color: role.color ?? null }
		});
		this.logger.log(`Role restored: ${roleId}`);
		return restored;
	}

	async hardDelete(roleId: string, userId: string) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		if (role.is_default)
			throw new ForbiddenException('Cannot hard-delete the default role');
		if (!role.deleted)
			throw new ForbiddenException('Role must be in trash before hard delete');

		const serverId = stringToRecordId.encode(role.server_id);
		if (!(await this.canActorManageRole(userId, serverId, role))) {
			throw new ForbiddenException('You cannot hard-delete roles at or above your highest role');
		}
		const ref = role.id as RecordId;
		const refEnc = stringToRecordId.encode(ref);
		// Scrub this role from every member.role_ids and emit MEMBER_UPDATE
		const allMembers = await this.members.findMany({ server_id: role.server_id });
		let member_count = 0;
		for (const m of allMembers) {
			const roleIds = (m.role_ids ?? []) as RecordId[];
			const filtered = roleIds.filter((rid) => stringToRecordId.encode(rid) !== refEnc);
			if (filtered.length !== roleIds.length) {
				member_count++;
				const updated = await this.members.merge(m.id, { role_ids: filtered });
				this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
			}
		}

		await this.roles.delete(roleId);
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'role_hard_delete',
			targetKind: 'role',
			targetId: roleId,
			metadata: { name: role.name, color: role.color ?? null, member_count }
		});
		this.logger.log(`Role hard-deleted: ${roleId} (${member_count} members affected)`);
	}

	async assignToMember(serverId: string, targetUserId: string, roleId: string, actorUserId: string) {
		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new NotFoundException('Member not found');

		const role = await this.roles.findById(roleId);
		if (!role) throw new NotFoundException('Role not found');
		if (stringToRecordId.encode(role.server_id) !== stringToRecordId.encode(ref))
			throw new ForbiddenException('Role does not belong to this server');
		if (role.deleted) throw new ForbiddenException('Cannot assign a trashed role');

		// Hierarchy: actor must outrank the role being granted.
		if (!(await this.canActorAssignRole(actorUserId, serverId, role))) {
			throw new ForbiddenException('You cannot assign roles at or above your highest role');
		}

		const roleIds = (member.role_ids ?? []) as RecordId[];
		const roleRef = role.id as RecordId;
		if (roleIds.some((rid) => stringToRecordId.encode(rid) === stringToRecordId.encode(roleRef))) return member;

		const updated = await this.members.merge(member.id, {
			role_ids: [...roleIds, roleRef],
			updated_at: new Date()
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'member_role_add',
			targetKind: 'member',
			targetId: targetUserId,
			targetUserId,
			metadata: { role_id: roleId, role_name: role.name, role_color: role.color ?? null }
		});
		return updated;
	}

	async unassignFromMember(serverId: string, targetUserId: string, roleId: string, actorUserId: string) {
		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new NotFoundException('Member not found');

		const roleIds = (member.role_ids ?? []) as RecordId[];
		const filtered = roleIds.filter((rid) => stringToRecordId.encode(rid) !== roleId);
		// Skip the no-op case so we don't spam the audit log
		if (filtered.length === roleIds.length) return member;

		const role = await this.roles.findById(roleId);
		// Hierarchy: actor must outrank the role being revoked.
		if (role && !(await this.canActorAssignRole(actorUserId, serverId, role))) {
			throw new ForbiddenException('You cannot unassign roles at or above your highest role');
		}
		const updated = await this.members.merge(member.id, {
			role_ids: filtered,
			updated_at: new Date()
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'member_role_remove',
			targetKind: 'member',
			targetId: targetUserId,
			targetUserId,
			metadata: {
				role_id: roleId,
				role_name: (role as any)?.name ?? null,
				role_color: (role as any)?.color ?? null
			}
		});
		return updated;
	}

	/**
	 * Compute the effective permissions bitmask for `userId` in `serverId`.
	 * Server owner gets ADMINISTRATOR.
	 *
	 * Otherwise: walk applicable roles (default + assigned, non-deleted) sorted
	 * low-to-high by position. For each role apply
	 *   `final = (final & ~deny) | allow`
	 * so higher-position roles override lower ones per-bit. Discord-style.
	 * Falls back to legacy `permissions` field for rows that haven't been
	 * backfilled into `permissions_allow` yet.
	 */
	/**
	 * 6-layer permission cascade (lowest → highest priority):
	 *   1. server role perms (existing role allow/deny sorted by position)
	 *   2. server user override
	 *   3. role category overrides (sorted by role position)
	 *   4. role channel overrides (sorted by role position)
	 *   5. user category override
	 *   6. user channel override
	 *
	 * User overrides always beat role overrides at the same scope.
	 * Channel scope always beats category scope for the same target type.
	 * Owner/admin bypass is checked at entry and after full computation.
	 * When `channelId` is omitted, only layers 1-2 apply (server-wide check).
	 *
	 * The cascade itself lives in `common/permission-fold`; this is the
	 * single-channel entry point onto it, so there is one copy of the rules.
	 */
	async computePermissions(userId: string, serverId: string, channelId?: string): Promise<bigint> {
		const fold = await this.loadPermissionFold(userId, serverId);
		// No channel asked for, or nothing channel-scoped could move the answer —
		// don't spend a query resolving the channel's category.
		if (!channelId || !fold.hasChannelScopedOverrides) return fold.serverPermissions;

		const categoryRef = await this.channels.findCategoryId(stringToRecordId.decode(channelId));
		return fold.forChannel(channelId, categoryRef ? stringToRecordId.encode(categoryRef) : null);
	}

	/**
	 * Load the server-scoped half of the cascade once and hand back a fold that
	 * answers for any number of channels.
	 *
	 * Callers that evaluate a whole server's channel list (`getVisibleChannels`,
	 * `buildPermissionTree`, `ChannelService.findVisibleByServer`) must use this
	 * rather than looping `computePermissions`: the server, member, role and
	 * override reads are identical for every channel, so looping re-issues them
	 * once per channel. Pass the channel's already-known `category_id` to
	 * `forChannel` — re-reading that column per channel is another query the
	 * caller already paid for.
	 *
	 * `MemberAccessService` cannot use this (it is on the
	 * `RoleService → ChatGateway → MemberAccessService` cycle) and owns the
	 * equivalent batch itself as `canReadChannels`. The shared piece is the
	 * cascade in `common/permission-fold`, not this loader.
	 */
	async loadPermissionFold(userId: string, serverId: string): Promise<PermissionFold> {
		const server = await this.servers.findById(serverId);
		if (!server) return constantPermissionFold(0n);
		if (server.owner_id === userId) return constantPermissionFold(Permissions.ADMINISTRATOR);

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return constantPermissionFold(0n);

		const roleIds = member.role_ids ?? [];
		return resolvePermissionFold({
			userId,
			roles: await this.roles.findMany({ server_id: ref }),
			assignedRoleIds: new Set(roleIds.map((rid) => stringToRecordId.encode(rid))),
			loadOverrides: () => this.permOverrides.findMany({ server_id: ref })
		});
	}

	async hasPermission(userId: string, serverId: string, flag: bigint, channelId?: string): Promise<boolean> {
		const perms = await this.computePermissions(userId, serverId, channelId);
		return hasPermission(perms, flag);
	}

	async requirePermission(userId: string, serverId: string, flag: bigint, channelId?: string): Promise<void> {
		const ok = await this.hasPermission(userId, serverId, flag, channelId);
		if (!ok) throw new Error('Insufficient permissions');
	}

	// ── Block 11: hierarchy primitives ──

	/**
	 * Owner = `Number.MAX_SAFE_INTEGER` so they outrank everything. Else =
	 * max(position) over assigned non-deleted roles, or 0 (@everyone implicit).
	 * Used by every "can actor X manage Y?" check.
	 */
	async highestRolePosition(userId: string, serverId: string): Promise<number> {
		const server = await this.servers.findById(serverId);
		if (!server) return -1;
		if (server.owner_id === userId) return Number.MAX_SAFE_INTEGER;

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return -1;

		const roleIds = (member.role_ids ?? []) as RecordId[];
		if (!roleIds.length) return 0;
		const assignedSet = new Set(roleIds.map((rid) => stringToRecordId.encode(rid)));

		const myRoles = (await this.roles.findMany({ server_id: ref }))
			.filter((r) => !r.deleted)
			.filter((r) =>
				assignedSet.has(stringToRecordId.encode(r.id as RecordId))
			);
		return myRoles.reduce(
			(max, r) => Math.max(max, (r.position as number) ?? 0),
			0
		);
	}

	async isOwner(userId: string, serverId: string): Promise<boolean> {
		const server = await this.servers.findById(serverId);
		return !!server && server.owner_id === userId;
	}

	async findMemberRoleIds(userId: string, serverId: string): Promise<string[]> {
		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return [];
		return (member.role_ids ?? []).map((rid: RecordId) =>
			stringToRecordId.encode(rid)
		);
	}

	async getVisibleChannels(
		userId: string,
		serverId: string
	): Promise<Array<{ id: string; name: string; type: string }>> {
		const ref = stringToRecordId.decode(serverId);
		// Scoped per channel, not server-wide: a category/channel override can
		// deny READ_MESSAGES to someone who holds it at the server level — and
		// grant it to someone who doesn't — so the server-level answer is not
		// the visible set. Same evaluation buildPermissionTree's can_view uses.
		// One fold for the whole server; the rows already carry `category_id`.
		const [fold, channels] = await Promise.all([
			this.loadPermissionFold(userId, serverId),
			this.channels.findLiveByServer(ref)
		]);
		const visible: Array<{ id: string; name: string; type: string }> = [];
		for (const c of channels) {
			const id = stringToRecordId.encode(c.id);
			const catId = c.category_id ? stringToRecordId.encode(c.category_id) : null;
			const perms = fold.forChannel(id, catId);
			if (!hasPermission(perms, Permissions.READ_MESSAGES)) continue;
			visible.push({ id, name: c.name ?? '', type: c.type ?? 'text' });
		}
		return visible;
	}

	async buildPermissionTree(userId: string, serverId: string): Promise<PermissionTree> {
		const ref = stringToRecordId.decode(serverId);

		// One fold for the whole tree — every node below reads the same
		// server-scoped state, so it is loaded once and replayed per channel.
		const fold = await this.loadPermissionFold(userId, serverId);
		const serverPerms = fold.serverPermissions;

		const [allCategories, allChannels] = await Promise.all([
			this.categories.findByServerOrdered(ref),
			this.channels.findLiveByServer(ref)
		]);

		const channelsByCategory = new Map<string, ChannelRow[]>();
		const uncategorized: ChannelRow[] = [];
		for (const ch of allChannels) {
			const catId = ch.category_id ? stringToRecordId.encode(ch.category_id as RecordId) : null;
			if (catId) {
				const list = channelsByCategory.get(catId) ?? [];
				list.push(ch);
				channelsByCategory.set(catId, list);
			} else {
				uncategorized.push(ch);
			}
		}

		// `categoryId` is threaded in from the row we already grouped by, so no
		// channel costs an extra read of its own `category_id` column.
		const buildChannelNode = (ch: ChannelRow, categoryId: string | null): PermissionTreeChannel => {
			const chId = stringToRecordId.encode(ch.id as RecordId);
			const perms = fold.forChannel(chId, categoryId);
			return {
				id: chId,
				name: (ch.name as string) ?? '',
				type: (ch.type as string) ?? 'text',
				position: (ch.position as number) ?? 0,
				permissions: perms.toString(),
				can_view: hasPermission(perms, Permissions.READ_MESSAGES)
			};
		};

		const categories = allCategories.map((cat) => {
			const catId = stringToRecordId.encode(cat.id as RecordId);
			const children = channelsByCategory.get(catId) ?? [];
			// The category's own scope — not its first child's. `forChannel`
			// would fold in that one channel's overrides, so a deny on it would
			// render the whole category denied, and an empty category would fall
			// back to `serverPerms` and lose the category overrides entirely.
			const catPerms = fold.forCategory(catId);
			return {
				id: catId,
				name: (cat.name as string) ?? '',
				position: (cat.position as number) ?? 0,
				permissions: catPerms.toString(),
				channels: children.map((ch) => buildChannelNode(ch, catId))
			};
		});

		const uncategorizedNodes = uncategorized.map((ch) => buildChannelNode(ch, null));

		return {
			server: { permissions: serverPerms.toString() },
			categories,
			uncategorized: uncategorizedNodes
		};
	}

	/** Strictly above. Owner bypass. */
	async canActorManageRole(
		actorId: string,
		serverId: string,
		role: { position?: number }
	): Promise<boolean> {
		if (await this.isOwner(actorId, serverId)) return true;
		const actorPos = await this.highestRolePosition(actorId, serverId);
		return actorPos > (role.position ?? 0);
	}

	/** Strictly above target's highest. Owner bypass. Self → true. */
	async canActorManageMember(
		actorId: string,
		serverId: string,
		targetUserId: string
	): Promise<boolean> {
		if (actorId === targetUserId) return true;
		if (await this.isOwner(actorId, serverId)) return true;
		const [actorPos, targetPos] = await Promise.all([
			this.highestRolePosition(actorId, serverId),
			this.highestRolePosition(targetUserId, serverId)
		]);
		return actorPos > targetPos;
	}

	/** Same rule as managing a role — actor must outrank the role being granted. */
	async canActorAssignRole(
		actorId: string,
		serverId: string,
		role: { position?: number }
	): Promise<boolean> {
		return this.canActorManageRole(actorId, serverId, role);
	}

	/**
	 * Pure helper. Returns true iff the *changed bits* (allow XOR + deny XOR)
	 * are entirely a subset of `actorPerms`. Owner bypass handled at call site.
	 * Note: ADMINISTRATOR in actorPerms does NOT short-circuit — granting a
	 * specific permission still requires holding that specific bit. Owner alone
	 * may grant arbitrary perms.
	 */
	canActorEditPerms(
		actorPerms: bigint,
		oldAllow: bigint,
		oldDeny: bigint,
		newAllow: bigint,
		newDeny: bigint
	): boolean {
		const changed = (newAllow ^ oldAllow) | (newDeny ^ oldDeny);
		return (changed & ~actorPerms) === 0n;
	}
}
