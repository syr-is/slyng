import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, hasPermission, stringToRecordId } from '@syren/types';
import { ServerRepository, ServerMemberRepository, ServerRoleRepository } from '../server/server.repository';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class RoleService {
	private readonly logger = new Logger(RoleService.name);

	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly roles: ServerRoleRepository,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async findByServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		return this.roles.findMany(
			{ server_id: ref },
			{ sort: { field: 'position', order: 'asc' } }
		);
	}

	async findById(roleId: string) {
		return this.roles.findById(roleId);
	}

	async create(serverId: string, userId: string, data: { name: string; color?: string | null; permissions?: string }) {
		await this.requirePermission(userId, serverId, Permissions.MANAGE_ROLES);

		const ref = stringToRecordId.decode(serverId);
		const existing = await this.roles.findMany({ server_id: ref });
		const position = existing.length;
		const now = new Date();

		const role = await this.roles.create({
			server_id: ref,
			name: data.name,
			color: data.color ?? null,
			permissions: data.permissions ?? '0',
			position,
			is_default: false,
			created_at: now,
			updated_at: now
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_CREATE, d: role });
		this.logger.log(`Role created: ${(role as any).id}`);
		return role;
	}

	async update(roleId: string, userId: string, data: { name?: string; color?: string | null; permissions?: string; position?: number }) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new Error('Role not found');
		const serverId = stringToRecordId.encode((role as any).server_id);
		await this.requirePermission(userId, serverId, Permissions.MANAGE_ROLES);

		if ((role as any).is_default && data.name !== undefined) {
			throw new Error('Cannot rename the default role');
		}

		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.color !== undefined) merge.color = data.color;
		if (data.permissions !== undefined) merge.permissions = data.permissions;
		if (data.position !== undefined) merge.position = data.position;

		const updated = await this.roles.merge(roleId, merge);
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updated });
		return updated;
	}

	/**
	 * Swap positions of two roles in the same server. Used by the hierarchy
	 * up/down arrows in the UI.
	 */
	async swapPositions(roleAId: string, roleBId: string, userId: string) {
		const a = await this.roles.findById(roleAId);
		const b = await this.roles.findById(roleBId);
		if (!a || !b) throw new Error('Role not found');
		if (stringToRecordId.encode((a as any).server_id) !== stringToRecordId.encode((b as any).server_id)) {
			throw new Error('Roles belong to different servers');
		}
		const serverId = stringToRecordId.encode((a as any).server_id);
		await this.requirePermission(userId, serverId, Permissions.MANAGE_ROLES);

		const posA = (a as any).position as number;
		const posB = (b as any).position as number;

		const updatedA = await this.roles.merge(roleAId, { position: posB, updated_at: new Date() });
		const updatedB = await this.roles.merge(roleBId, { position: posA, updated_at: new Date() });
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updatedA });
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_UPDATE, d: updatedB });
		return { a: updatedA, b: updatedB };
	}

	async delete(roleId: string, userId: string) {
		const role = await this.roles.findById(roleId);
		if (!role) throw new Error('Role not found');
		if ((role as any).is_default) throw new Error('Cannot delete the default role');

		const serverId = stringToRecordId.encode((role as any).server_id);
		await this.requirePermission(userId, serverId, Permissions.MANAGE_ROLES);

		// Remove this role from all members that have it
		const ref = (role as any).id as RecordId;
		const members = await this.members.findMany({ server_id: (role as any).server_id });
		for (const m of members) {
			const roleIds = ((m as any).role_ids ?? []) as RecordId[];
			const filtered = roleIds.filter((rid) => stringToRecordId.encode(rid) !== stringToRecordId.encode(ref));
			if (filtered.length !== roleIds.length) {
				const updated = await this.members.merge((m as any).id, { role_ids: filtered });
				this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
			}
		}

		await this.roles.delete(roleId);
		this.gateway?.emitToServer(serverId, { op: WsOp.ROLE_DELETE, d: { id: roleId, server_id: serverId } });
		this.logger.log(`Role deleted: ${roleId}`);
	}

	async assignToMember(serverId: string, targetUserId: string, roleId: string, actorUserId: string) {
		await this.requirePermission(actorUserId, serverId, Permissions.MANAGE_ROLES);

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new Error('Member not found');

		const role = await this.roles.findById(roleId);
		if (!role) throw new Error('Role not found');
		if (stringToRecordId.encode((role as any).server_id) !== stringToRecordId.encode(ref)) throw new Error('Role does not belong to this server');

		const roleIds = ((member as any).role_ids ?? []) as RecordId[];
		const roleRef = (role as any).id as RecordId;
		if (roleIds.some((rid) => stringToRecordId.encode(rid) === stringToRecordId.encode(roleRef))) return member;

		const updated = await this.members.merge((member as any).id, {
			role_ids: [...roleIds, roleRef],
			updated_at: new Date()
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
		return updated;
	}

	async unassignFromMember(serverId: string, targetUserId: string, roleId: string, actorUserId: string) {
		await this.requirePermission(actorUserId, serverId, Permissions.MANAGE_ROLES);

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new Error('Member not found');

		const roleIds = ((member as any).role_ids ?? []) as RecordId[];
		const filtered = roleIds.filter((rid) => stringToRecordId.encode(rid) !== roleId);

		const updated = await this.members.merge((member as any).id, {
			role_ids: filtered,
			updated_at: new Date()
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.MEMBER_UPDATE, d: updated });
		return updated;
	}

	/**
	 * Compute the effective permissions bitmask for `userId` in `serverId`.
	 * Server owner gets ADMINISTRATOR; otherwise OR of all role permissions.
	 */
	async computePermissions(userId: string, serverId: string): Promise<bigint> {
		const server = await this.servers.findById(serverId);
		if (!server) return 0n;
		if ((server as any).owner_id === userId) return Permissions.ADMINISTRATOR;

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return 0n;

		const roleIds = ((member as any).role_ids ?? []) as RecordId[];
		const allRoles = await this.roles.findMany({ server_id: ref });

		// Default role applies to everyone in the server
		let perms = 0n;
		for (const role of allRoles) {
			const isDefault = (role as any).is_default;
			const isAssigned = roleIds.some((rid) => stringToRecordId.encode(rid) === stringToRecordId.encode((role as any).id));
			if (isDefault || isAssigned) {
				perms |= BigInt((role as any).permissions ?? '0');
			}
		}
		return perms;
	}

	async hasPermission(userId: string, serverId: string, flag: bigint): Promise<boolean> {
		const perms = await this.computePermissions(userId, serverId);
		return hasPermission(perms, flag);
	}

	async requirePermission(userId: string, serverId: string, flag: bigint): Promise<void> {
		const ok = await this.hasPermission(userId, serverId, flag);
		if (!ok) throw new Error('Insufficient permissions');
	}
}
