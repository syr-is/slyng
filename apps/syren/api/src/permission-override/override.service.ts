import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import {
	Permissions,
	WsOp,
	stringToRecordId,
	type PermissionScopeType,
	type PermissionTargetType
} from '@syren/types';
import { PermissionOverrideRepository } from './override.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { Optional } from '@nestjs/common';

@Injectable()
export class OverrideService {
	private readonly logger = new Logger(OverrideService.name);

	constructor(
		private readonly overrides: PermissionOverrideRepository,
		private readonly roleService: RoleService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async listForServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		return this.overrides.findMany(
			{ server_id: ref },
			{ sort: { field: 'created_at', order: 'asc' } }
		);
	}

	async listForScope(serverId: string, scopeType: PermissionScopeType, scopeId: string) {
		const serverRef = stringToRecordId.decode(serverId);
		const scopeRef = stringToRecordId.decode(scopeId);
		return this.overrides.findMany(
			{ server_id: serverRef, scope_type: scopeType, scope_id: scopeRef },
			{ sort: { field: 'created_at', order: 'asc' } }
		);
	}

	async upsert(
		serverId: string,
		actorUserId: string,
		data: {
			scope_type: PermissionScopeType;
			scope_id: string | null;
			target_type: PermissionTargetType;
			target_id: string;
			allow: string;
			deny: string;
		}
	) {
		await this.enforceHierarchy(serverId, actorUserId, data.target_type, data.target_id);
		await this.enforcePermCap(serverId, actorUserId, data.allow, data.deny);

		const serverRef = stringToRecordId.decode(serverId);
		const scopeRef = data.scope_id ? stringToRecordId.decode(data.scope_id) : null;
		const now = new Date();

		const existing = await this.overrides.findOne({
			server_id: serverRef,
			scope_type: data.scope_type,
			scope_id: scopeRef,
			target_type: data.target_type,
			target_id: data.target_id
		});

		let result: unknown;
		if (existing) {
			result = await this.overrides.merge((existing as any).id, {
				allow: data.allow,
				deny: data.deny,
				updated_at: now
			});
		} else {
			result = await this.overrides.create({
				server_id: serverRef,
				scope_type: data.scope_type,
				scope_id: scopeRef,
				target_type: data.target_type,
				target_id: data.target_id,
				allow: data.allow,
				deny: data.deny,
				created_at: now,
				updated_at: now
			} as any);
		}

		this.gateway?.emitToServer(serverId, {
			op: WsOp.PERMISSION_OVERRIDE_UPDATE,
			d: {
				server_id: serverId,
				scope_type: data.scope_type,
				scope_id: data.scope_id,
				target_type: data.target_type,
				target_id: data.target_id
			}
		});
		this.logger.log(
			`Override upserted: ${data.scope_type}/${data.scope_id ?? 'server'} ${data.target_type}/${data.target_id.slice(0, 18)}`
		);
		return result;
	}

	async remove(serverId: string, actorUserId: string, overrideId: string) {
		const override = await this.overrides.findById(overrideId);
		if (!override) throw new NotFoundException('Override not found');
		const o = override as any;

		await this.enforceHierarchy(
			serverId,
			actorUserId,
			o.target_type as PermissionTargetType,
			o.target_id as string
		);

		await this.overrides.delete(overrideId);
		this.gateway?.emitToServer(serverId, {
			op: WsOp.PERMISSION_OVERRIDE_UPDATE,
			d: {
				server_id: serverId,
				scope_type: o.scope_type,
				scope_id: o.scope_id ? stringToRecordId.encode(o.scope_id as RecordId) : null,
				target_type: o.target_type,
				target_id: o.target_id
			}
		});
	}

	private async enforceHierarchy(
		serverId: string,
		actorUserId: string,
		targetType: PermissionTargetType,
		targetId: string
	) {
		if (targetType === 'user') {
			const ok = await this.roleService.canActorManageMember(actorUserId, serverId, targetId);
			if (!ok) throw new ForbiddenException('Cannot manage a member at or above your role');
		} else {
			const role = await this.roleService.findRoleById(targetId);
			if (!role) throw new NotFoundException('Role not found');
			const ok = await this.roleService.canActorManageRole(actorUserId, serverId, role as any);
			if (!ok) throw new ForbiddenException('Cannot manage a role at or above yours');
		}
	}

	private async enforcePermCap(
		serverId: string,
		actorUserId: string,
		allow: string,
		deny: string
	) {
		const actorPerms = await this.roleService.computePermissions(actorUserId, serverId);
		// ADMINISTRATOR implies all permissions — skip the per-bit check
		if ((actorPerms & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return;
		const allowBits = BigInt(allow || '0');
		const denyBits = BigInt(deny || '0');
		const changed = allowBits | denyBits;
		if ((changed & ~actorPerms) !== 0n) {
			throw new ForbiddenException('Cannot grant or deny permissions you do not hold');
		}
	}
}
