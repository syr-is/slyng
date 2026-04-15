import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, stringToRecordId } from '@syren/types';
import {
	ChannelRepository,
	ChannelParticipantRepository,
	ChannelReadStateRepository
} from './channel.repository';
import {
	MessageRepository,
	MessageReactionRepository,
	PinnedMessageRepository
} from '../message/message.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class ChannelService {
	private readonly logger = new Logger(ChannelService.name);

	constructor(
		private readonly channels: ChannelRepository,
		private readonly participants: ChannelParticipantRepository,
		private readonly readStates: ChannelReadStateRepository,
		private readonly messages: MessageRepository,
		private readonly reactions: MessageReactionRepository,
		private readonly pins: PinnedMessageRepository,
		private readonly roleService: RoleService,
		private readonly audit: AuditLogService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	private async getServerIdForChannel(channelId: string): Promise<string> {
		const channel = await this.channels.findById(channelId);
		if (!channel) throw new Error('Channel not found');
		const sid = (channel as any).server_id;
		if (!sid) throw new Error('Channel has no server (DM)');
		return stringToRecordId.encode(sid);
	}

	async findByServer(serverId: RecordId | string) {
		const ref = serverId instanceof RecordId ? serverId : stringToRecordId.decode(serverId);
		return this.channels.findMany(
			{ server_id: ref },
			{ sort: { field: 'position', order: 'asc' } }
		);
	}

	async findById(channelId: string) {
		return this.channels.findById(channelId);
	}

	async update(channelId: string, userId: string, data: { name?: string; topic?: string }) {
		const serverId = await this.getServerIdForChannel(channelId);
		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.topic !== undefined) merge.topic = data.topic;
		await this.channels.merge(channelId, merge);
		const updated = await this.channels.findById(channelId);
		this.gateway?.emitToServer(serverId, { op: WsOp.CHANNEL_UPDATE, d: updated });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_update',
			targetKind: 'channel',
			targetId: channelId,
			metadata: { changes: data, name: (updated as any)?.name }
		});
		return updated;
	}

	async delete(channelId: string, userId: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		const snapshot = await this.channels.findById(channelId);
		const id = stringToRecordId.decode(channelId);
		await Promise.all([
			this.messages.deleteWhere({ channel_id: id }),
			this.pins.deleteWhere({ channel_id: id }),
			this.readStates.deleteWhere({ channel_id: id })
		]);
		await this.channels.delete(channelId);
		this.gateway?.emitToServer(serverId, {
			op: WsOp.CHANNEL_DELETE,
			d: { id: channelId, server_id: serverId }
		});
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_delete',
			targetKind: 'channel',
			targetId: channelId,
			metadata: { name: (snapshot as any)?.name, type: (snapshot as any)?.type }
		});
		this.logger.log(`Channel deleted: ${channelId}`);
	}

	async create(serverId: string, createdBy: string, name: string, type = 'text', categoryId?: string) {
		const now = new Date();
		const serverRef = stringToRecordId.decode(serverId);
		const categoryRef = categoryId ? stringToRecordId.decode(categoryId) : null;

		// Determine next position
		const existing = await this.channels.findMany(
			{ server_id: serverRef },
			{ sort: { field: 'position', order: 'desc' }, limit: 1 }
		);
		const position = (((existing[0] as any)?.position as number) ?? -1) + 1;

		const channel = await this.channels.create({
			type,
			name,
			server_id: serverRef,
			category_id: categoryRef,
			position,
			created_by: createdBy,
			created_at: now,
			updated_at: now
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.CHANNEL_CREATE, d: channel });
		await this.audit.record({
			serverId,
			actorId: createdBy,
			action: 'channel_create',
			targetKind: 'channel',
			targetId: stringToRecordId.encode((channel as any).id),
			metadata: { name, type }
		});
		return channel;
	}

	async findDMChannels(userId: string) {
		const myParticipations = await this.participants.findMany({ user_id: userId });
		if (!myParticipations.length) return [];

		const channelIds = myParticipations.map((p) => (p as any).channel_id as RecordId);
		const all = await this.channels.findByIds(channelIds);
		return all
			.filter((c) => (c as any).type === 'direct' || (c as any).type === 'group')
			.sort((a, b) => {
				const aTime = new Date((a as any).last_message_at ?? 0).getTime();
				const bTime = new Date((b as any).last_message_at ?? 0).getTime();
				return bTime - aTime;
			});
	}

	async createDM(userId: string, otherUserId: string) {
		const now = new Date();

		// Check if DM already exists
		const myParticipations = await this.participants.findMany({ user_id: userId });
		const theirParticipations = await this.participants.findMany({ user_id: otherUserId });

		const theirSet = new Set(
			theirParticipations.map((p) => stringToRecordId.encode((p as any).channel_id as RecordId))
		);
		for (const p of myParticipations) {
			const channelIdStr = stringToRecordId.encode((p as any).channel_id as RecordId);
			if (theirSet.has(channelIdStr)) {
				const ch = await this.channels.findById((p as any).channel_id);
				if (ch && (ch as any).type === 'direct') return ch;
			}
		}

		// Create new DM channel
		const channel = await this.channels.create({
			type: 'direct',
			created_by: userId,
			created_at: now,
			updated_at: now
		});
		const channelId = (channel as any).id as RecordId;

		for (const uid of [userId, otherUserId]) {
			await this.participants.create({
				channel_id: channelId,
				user_id: uid,
				role: 'member',
				joined_at: now,
				created_at: now,
				updated_at: now
			});
		}

		return channel;
	}
}
