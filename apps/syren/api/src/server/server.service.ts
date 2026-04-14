import { Injectable, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { DEFAULT_PERMISSIONS, Permissions, WsOp, stringToRecordId } from '@syren/types';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository
} from './server.repository';
import { ChannelRepository } from '../channel/channel.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { Inject, Optional } from '@nestjs/common';

@Injectable()
export class ServerService {
	private readonly logger = new Logger(ServerService.name);

	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly roles: ServerRoleRepository,
		private readonly invites: ServerInviteRepository,
		private readonly channels: ChannelRepository,
		private readonly roleService: RoleService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async create(
		ownerId: string,
		name: string,
		opts: {
			iconUrl?: string;
			bannerUrl?: string;
			inviteBackgroundUrl?: string;
			description?: string;
		} = {}
	) {
		const now = new Date();

		const server = await this.servers.create({
			name,
			icon_url: opts.iconUrl ?? null,
			banner_url: opts.bannerUrl ?? null,
			invite_background_url: opts.inviteBackgroundUrl ?? null,
			description: opts.description ?? null,
			owner_id: ownerId,
			member_count: 1,
			created_at: now,
			updated_at: now
		});
		const serverId = (server as any).id as RecordId;

		await this.roles.create({
			server_id: serverId,
			name: 'everyone',
			color: null,
			position: 0,
			permissions: DEFAULT_PERMISSIONS.toString(),
			is_default: true,
			created_at: now,
			updated_at: now
		});

		await this.members.create({
			server_id: serverId,
			user_id: ownerId,
			nickname: null,
			role_ids: [],
			joined_at: now,
			created_at: now,
			updated_at: now
		});

		await this.channels.create({
			type: 'text',
			name: 'general',
			server_id: serverId,
			position: 0,
			created_by: ownerId,
			created_at: now,
			updated_at: now
		});

		this.logger.log(`Server created: ${serverId}`);
		return server;
	}

	async findById(serverId: string) {
		return this.servers.findById(serverId);
	}

	async update(
		serverId: string,
		userId: string,
		data: {
			name?: string;
			description?: string;
			icon_url?: string | null;
			banner_url?: string | null;
			invite_background_url?: string | null;
		}
	) {
		const server = await this.servers.findById(serverId);
		if (!server) throw new Error('Server not found');
		await this.roleService.requirePermission(userId, serverId, Permissions.MANAGE_SERVER);

		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.description !== undefined) merge.description = data.description;
		if (data.icon_url !== undefined) merge.icon_url = data.icon_url;
		if (data.banner_url !== undefined) merge.banner_url = data.banner_url;
		if (data.invite_background_url !== undefined) merge.invite_background_url = data.invite_background_url;

		await this.servers.merge(serverId, merge);
		const updated = await this.servers.findById(serverId);
		this.gateway?.emitToServer(serverId, { op: WsOp.SERVER_UPDATE, d: updated });
		this.logger.log(`Server updated: ${serverId}`);
		return updated;
	}

	async findInvitePreview(code: string) {
		const invite = await this.invites.findOne({ code });
		if (!invite) throw new Error('Invalid invite code');
		const inv = invite as any;
		if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
			throw new Error('Invite has expired');
		}
		if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
			throw new Error('Invite has reached maximum uses');
		}

		const server = await this.servers.findById(inv.server_id);
		if (!server) throw new Error('Server no longer exists');
		const s = server as any;

		return {
			code: inv.code as string,
			server: {
				id: stringToRecordId.encode(s.id as RecordId),
				name: s.name as string,
				icon_url: (s.icon_url ?? null) as string | null,
				banner_url: (s.banner_url ?? null) as string | null,
				invite_background_url: (s.invite_background_url ?? null) as string | null,
				description: (s.description ?? null) as string | null,
				member_count: (s.member_count ?? 0) as number
			}
		};
	}

	async delete(serverId: string, userId: string) {
		const server = await this.servers.findById(serverId);
		if (!server) throw new Error('Server not found');
		if ((server as any).owner_id !== userId) throw new Error('Only the server owner can delete the server');

		const id = stringToRecordId.decode(serverId);
		// Broadcast first so subscribers can react while topic subscriptions still resolve
		this.gateway?.emitToServer(serverId, { op: WsOp.SERVER_DELETE, d: { id: serverId } });
		await Promise.all([
			this.channels.deleteWhere({ server_id: id }),
			this.members.deleteWhere({ server_id: id }),
			this.roles.deleteWhere({ server_id: id }),
			this.invites.deleteWhere({ server_id: id })
		]);
		await this.servers.delete(serverId);

		this.logger.log(`Server deleted: ${serverId}`);
	}

	async findByMember(userId: string) {
		const memberships = await this.members.findMany({ user_id: userId });
		if (!memberships.length) return [];
		const serverIds = memberships.map((m) => (m as any).server_id as RecordId);
		return this.servers.findByIds(serverIds);
	}

	async createInvite(serverId: string, createdBy: string, maxUses = 0, expiresIn?: number) {
		await this.roleService.requirePermission(createdBy, serverId, Permissions.CREATE_INVITES);

		const code = this.generateInviteCode();
		const now = new Date();
		const expiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null;
		const serverRef = stringToRecordId.decode(serverId);

		await this.invites.create({
			server_id: serverRef,
			code,
			created_by: createdBy,
			max_uses: maxUses,
			uses: 0,
			expires_at: expiresAt,
			created_at: now,
			updated_at: now
		});

		return { code };
	}

	async joinByInvite(userId: string, code: string) {
		const invite = await this.invites.findOne({ code });
		if (!invite) throw new Error('Invalid invite code');

		const inv = invite as any;
		if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
			throw new Error('Invite has expired');
		}
		if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
			throw new Error('Invite has reached maximum uses');
		}

		const existing = await this.members.findOne({ server_id: inv.server_id, user_id: userId });
		if (existing) return { server_id: inv.server_id, already_member: true };

		const now = new Date();
		await this.members.create({
			server_id: inv.server_id,
			user_id: userId,
			nickname: null,
			role_ids: [],
			joined_at: now,
			created_at: now,
			updated_at: now
		});

		await this.invites.merge((inv.id as RecordId), { uses: inv.uses + 1, updated_at: now });
		await this.servers.merge(inv.server_id, { member_count: ((await this.servers.findById(inv.server_id))?.member_count as number ?? 0) + 1 });

		// Broadcast new member to all clients viewing this server
		this.gateway?.emitToServer(stringToRecordId.encode(inv.server_id as RecordId), {
			op: WsOp.MEMBER_UPDATE,
			d: {
				server_id: stringToRecordId.encode(inv.server_id as RecordId),
				user_id: userId,
				role_ids: [],
				joined_at: now.toISOString()
			}
		});

		return { server_id: inv.server_id, already_member: false };
	}

	private generateInviteCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
		let code = '';
		for (let i = 0; i < 8; i++) {
			code += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return code;
	}
}
