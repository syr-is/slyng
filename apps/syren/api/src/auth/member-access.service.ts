import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, hasPermission, stringToRecordId } from '@syren/types';
import { PermissionOverrideRepository } from '../permission-override/override.repository';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerBanRepository,
	ServerRoleRepository
} from '../server/server.repository';
import { ChannelRepository, ChannelCategoryRepository } from '../channel/channel.repository';

/**
 * Shared server-access authoriser used by:
 *  - `ServerAccessGuard` (HTTP route protection)
 *  - `ChatGateway.handleSubscribe` (WS topic protection)
 *
 * Kept separate from `MemberService` / `ServerService` to avoid circular DI
 * between the gateway module and the server/member modules.
 */
@Injectable()
export class MemberAccessService {
	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly bans: ServerBanRepository,
		private readonly roles: ServerRoleRepository,
		private readonly channels: ChannelRepository,
		private readonly categories: ChannelCategoryRepository,
		private readonly permOverrides: PermissionOverrideRepository
	) {}

	/**
	 * Given a topic id (either a server id or a channel id), resolve which
	 * server it belongs to. Returns null for topics that aren't server-scoped
	 * (e.g. DM channels if/when we add them) so callers can treat those as
	 * "no membership check required".
	 */
	async resolveServerId(topicId: string): Promise<string | null> {
		if (!topicId) return null;
		if (topicId.startsWith('server:')) {
			const exists = await this.servers.findById(topicId);
			return exists ? topicId : null;
		}
		if (topicId.startsWith('channel:')) {
			const channel = await this.channels.findById(topicId);
			if (!channel) return null;
			const sid = (channel as any).server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		// Unknown prefix — not a server-scoped topic
		return null;
	}

	/**
	 * Resolve which server a request targets via its route params. Returns
	 * null when the route isn't server-scoped (e.g. /servers/@me, /users/...).
	 * Shared by `ServerAccessGuard` + `PermissionGuard`.
	 */
	async resolveRouteServerId(req: any): Promise<string | null> {
		const params = req?.params ?? {};
		if (params.serverId) return params.serverId as string;
		if (params.channelId) {
			const channel = await this.channels.findById(params.channelId);
			if (!channel) return null;
			const sid = (channel as any).server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		if (params.roleId) {
			const role = await this.roles.findById(params.roleId);
			if (!role) return null;
			const sid = (role as any).server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		if (params.categoryId) {
			const cat = await this.categories.findById(params.categoryId);
			if (!cat) return null;
			const sid = (cat as any).server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		return null;
	}

	async isMember(userId: string, serverId: string): Promise<boolean> {
		const ref = stringToRecordId.decode(serverId);
		const row = await this.members.findOne({ server_id: ref, user_id: userId });
		return !!row;
	}

	async isBanned(userId: string, serverId: string): Promise<boolean> {
		const ref = stringToRecordId.decode(serverId);
		// Only ACTIVE bans count — unbanned rows are kept for audit history.
		const row = await this.bans.findOne({ server_id: ref, user_id: userId, active: true });
		return !!row;
	}

	/** True iff user may read/listen to the server (member AND not banned). */
	async isAllowed(userId: string, serverId: string): Promise<boolean> {
		if (await this.isBanned(userId, serverId)) return false;
		return this.isMember(userId, serverId);
	}

	/** Check if a user can read a specific channel (server membership + READ_MESSAGES override cascade). */
	async canReadChannel(userId: string, channelId: string): Promise<boolean> {
		const channel = await this.channels.findById(channelId);
		if (!channel) return false;
		const sid = (channel as any).server_id as RecordId | string | undefined;
		if (!sid) return true; // DM channels — no server scope
		const serverId = stringToRecordId.encode(sid as RecordId);

		if (!(await this.isAllowed(userId, serverId))) return false;

		// Check if server owner — always allowed
		const server = await this.servers.findById(serverId);
		if (server && (server as any).owner_id === userId) return true;

		// Compute permissions with channel context inline (lightweight version
		// to avoid circular dep on RoleService). Mirrors the 6-layer cascade.
		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return false;

		const roleIds = ((member as any).role_ids ?? []) as RecordId[];
		const assignedSet = new Set(roleIds.map((rid) => stringToRecordId.encode(rid)));

		const allRoles = (await this.roles.findMany({ server_id: ref }))
			.filter((r) => !(r as any).deleted)
			.sort((a, b) => (((a as any).position as number) ?? 0) - (((b as any).position as number) ?? 0));

		const applicable = allRoles.filter(
			(r) => (r as any).is_default || assignedSet.has(stringToRecordId.encode((r as any).id as RecordId))
		);

		// Layer 1: server role perms
		let perms = 0n;
		for (const r of applicable) {
			const allow = BigInt(((r as any).permissions_allow as string) ?? ((r as any).permissions as string) ?? '0');
			const deny = BigInt(((r as any).permissions_deny as string) ?? '0');
			perms = (perms & ~deny) | allow;
		}
		if (hasPermission(perms, Permissions.ADMINISTRATOR)) return true;

		// Fetch overrides
		const allOverrides = await this.permOverrides.findMany({ server_id: ref });

		const applyOverride = (o: any) => {
			const allow = BigInt((o.allow as string) ?? '0');
			const deny = BigInt((o.deny as string) ?? '0');
			perms = (perms & ~deny) | allow;
		};

		const roleOverridesForScope = (scopeType: string, scopeId: string | null) =>
			allOverrides
				.filter((o: any) => {
					if (o.target_type !== 'role' || o.scope_type !== scopeType) return false;
					const oSid = o.scope_id ? stringToRecordId.encode(o.scope_id as RecordId) : null;
					if (oSid !== scopeId) return false;
					return assignedSet.has(o.target_id as string) ||
						allRoles.some((r) => (r as any).is_default && stringToRecordId.encode((r as any).id as RecordId) === o.target_id);
				})
				.sort((a: any, b: any) => {
					const pa = allRoles.find((r) => stringToRecordId.encode((r as any).id as RecordId) === a.target_id);
					const pb = allRoles.find((r) => stringToRecordId.encode((r as any).id as RecordId) === b.target_id);
					return (((pa as any)?.position as number) ?? 0) - (((pb as any)?.position as number) ?? 0);
				});

		const userOverride = (scopeType: string, scopeId: string | null) =>
			allOverrides.find((o: any) => {
				if (o.target_type !== 'user' || o.target_id !== userId || o.scope_type !== scopeType) return false;
				const oSid = o.scope_id ? stringToRecordId.encode(o.scope_id as RecordId) : null;
				return oSid === scopeId;
			});

		// Layer 2: server user override
		const srvUser = userOverride('server', null);
		if (srvUser) applyOverride(srvUser);

		// Resolve category
		const catId = (channel as any).category_id
			? stringToRecordId.encode((channel as any).category_id as RecordId)
			: null;

		// Layer 3-4: category role + channel role
		if (catId) for (const o of roleOverridesForScope('category', catId)) applyOverride(o);
		for (const o of roleOverridesForScope('channel', channelId)) applyOverride(o);

		// Layer 5-6: category user + channel user
		if (catId) { const cu = userOverride('category', catId); if (cu) applyOverride(cu); }
		const chu = userOverride('channel', channelId);
		if (chu) applyOverride(chu);

		return hasPermission(perms, Permissions.READ_MESSAGES);
	}
}
