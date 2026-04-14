import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, stringToRecordId } from '@syren/types';
import { ServerRepository, ServerMemberRepository, ServerRoleRepository } from '../server/server.repository';
import { ChannelReadStateRepository } from '../channel/channel.repository';
import { UserRepository } from '../auth/user.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';

@Injectable()
export class MemberService {
	private readonly logger = new Logger(MemberService.name);

	constructor(
		private readonly members: ServerMemberRepository,
		private readonly readStates: ChannelReadStateRepository,
		private readonly users: UserRepository,
		private readonly roles: ServerRoleRepository,
		private readonly servers: ServerRepository,
		private readonly roleService: RoleService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async kick(serverId: string, targetUserId: string, actorUserId: string) {
		const server = await this.servers.findById(serverId);
		if (!server) throw new Error('Server not found');
		if ((server as any).owner_id === targetUserId) throw new Error('Cannot kick the server owner');
		if (targetUserId === actorUserId) throw new Error('Cannot kick yourself');
		await this.roleService.requirePermission(actorUserId, serverId, Permissions.KICK_MEMBERS);

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new Error('Member not found');

		await this.members.delete((member as any).id);
		await this.servers.merge(serverId, {
			member_count: Math.max(0, ((server as any).member_count ?? 1) - 1)
		});

		this.gateway?.emitToServer(serverId, {
			op: WsOp.MEMBER_REMOVE,
			d: { server_id: serverId, user_id: targetUserId }
		});
		this.logger.log(`Member kicked: ${targetUserId} from ${serverId} by ${actorUserId}`);
	}

	async findByServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		const members = await this.members.findMany(
			{ server_id: ref },
			{ sort: { field: 'joined_at', order: 'asc' } }
		);
		if (!members.length) return [];

		// Attach syr_instance_url + resolved roles so the client can render
		// names + role colors. Profile data itself is NOT stored here.
		const userIds = [...new Set(members.map((m) => (m as any).user_id as string))];
		const users = await this.users.findMany();
		const instanceMap = new Map<string, string>(
			users
				.filter((u) => userIds.includes((u as any).did as string))
				.map((u) => [(u as any).did as string, (u as any).syr_instance_url as string])
		);

		const roles = await this.roles.findMany({ server_id: ref });
		const roleMap = new Map<string, { id: string; name: string; color: string | null; position: number }>(
			roles.map((r) => [
				stringToRecordId.encode((r as any).id),
				{
					id: stringToRecordId.encode((r as any).id),
					name: (r as any).name as string,
					color: (r as any).color as string | null,
					position: (r as any).position as number
				}
			])
		);

		return members.map((m) => {
			const roleIds = (((m as any).role_ids ?? []) as RecordId[]).map((r) => stringToRecordId.encode(r));
			const memberRoles = roleIds
				.map((id) => roleMap.get(id))
				.filter((r): r is NonNullable<typeof r> => !!r)
				.sort((a, b) => b.position - a.position); // highest position first
			return {
				...m,
				syr_instance_url: instanceMap.get((m as any).user_id as string),
				roles: memberRoles
			};
		});
	}

	async getUnreadCounts(userId: string) {
		const rows = await this.readStates.findMany({ user_id: userId });
		return rows.map((r) => ({
			channel_id: (r as any).channel_id,
			last_read_message_id: (r as any).last_read_message_id,
			mention_count: (r as any).mention_count ?? 0
		}));
	}

	async markChannelRead(userId: string, channelId: string, lastMessageId: string) {
		const channelRef = stringToRecordId.decode(channelId);
		const messageRef = stringToRecordId.decode(lastMessageId);
		const existing = await this.readStates.findOne({ user_id: userId, channel_id: channelRef });
		const now = new Date();

		if (existing) {
			await this.readStates.merge((existing as any).id, {
				last_read_message_id: messageRef,
				mention_count: 0,
				updated_at: now
			});
		} else {
			await this.readStates.create({
				user_id: userId,
				channel_id: channelRef,
				last_read_message_id: messageRef,
				mention_count: 0,
				created_at: now,
				updated_at: now
			});
		}
	}

	async incrementMentions(userId: string, channelId: string) {
		const channelRef = stringToRecordId.decode(channelId);
		const existing = await this.readStates.findOne({ user_id: userId, channel_id: channelRef });
		const now = new Date();

		if (existing) {
			await this.readStates.merge((existing as any).id, {
				mention_count: ((existing as any).mention_count ?? 0) + 1,
				updated_at: now
			});
		} else {
			await this.readStates.create({
				user_id: userId,
				channel_id: channelRef,
				mention_count: 1,
				created_at: now,
				updated_at: now
			});
		}
	}
}
