import { Injectable, Optional, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, hasPermission, stringToRecordId } from '@syren/types';
import { RelationService } from '../relation/relation.service';
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
import { UserRepository } from '../auth/user.repository';
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
		private readonly users: UserRepository,
		private readonly roleService: RoleService,
		private readonly relations: RelationService,
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
			{ server_id: ref, deleted: false },
			{ sort: { field: 'position', order: 'asc' } }
		);
	}

	async findVisibleByServer(serverId: string, userId: string) {
		const all = await this.findByServer(serverId);
		const results = await Promise.all(
			all.map(async (ch) => {
				const chId = stringToRecordId.encode((ch as any).id as RecordId);
				const perms = await this.roleService.computePermissions(userId, serverId, chId);
				const canRead = hasPermission(perms, Permissions.READ_MESSAGES);
				return { channel: ch, perms, canRead };
			})
		);
		return results
			.filter((r) => r.canRead)
			.map((r) => ({
				...(r.channel as any),
				my_permissions: r.perms.toString()
			}));
	}

	/**
	 * Public read path: hides soft-deleted channels from normal callers.
	 * Use `findByIdRaw` when you need the row regardless of trash state
	 * (trash listing, restore, hard-delete, route resolution).
	 */
	async findById(channelId: string) {
		const ch = await this.channels.findById(channelId);
		if (!ch || (ch as any).deleted) return null;
		return ch;
	}

	async findByIdRaw(channelId: string) {
		return this.channels.findById(channelId);
	}

	async listTrashedForServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		const rows = await this.channels.findMany(
			{ server_id: ref, deleted: true },
			{ sort: { field: 'deleted_at', order: 'desc' } }
		);
		// Enrich with message_count so the UI can show blast radius
		const enriched = await Promise.all(
			rows.map(async (r) => {
				const message_count = await this.messages.count({ channel_id: (r as any).id });
				return { ...(r as any), message_count };
			})
		);
		return enriched;
	}

	async update(channelId: string, userId: string, data: { name?: string; topic?: string; category_id?: string | null }) {
		const serverId = await this.getServerIdForChannel(channelId);
		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.topic !== undefined) merge.topic = data.topic;
		if (data.category_id !== undefined) {
			merge.category_id = data.category_id
				? stringToRecordId.decode(data.category_id)
				: null;
		}
		await this.channels.merge(channelId, merge);
		const updated = await this.channels.findById(channelId);
		this.gateway?.emitToServer(serverId, { op: WsOp.CHANNEL_UPDATE, d: updated });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_update',
			targetKind: 'channel',
			targetId: channelId,
			channelId,
			metadata: { changes: data, name: (updated as any)?.name }
		});
		return updated;
	}

	async delete(channelId: string, userId: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		const snapshot = await this.channels.findById(channelId);
		if (!snapshot) throw new NotFoundException('Channel not found');
		if ((snapshot as any).deleted) throw new ForbiddenException('Channel already in trash');
		const now = new Date();
		await this.channels.merge(channelId, {
			deleted: true,
			deleted_at: now,
			deleted_by: userId,
			updated_at: now
		});
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
			channelId,
			metadata: { name: (snapshot as any)?.name, type: (snapshot as any)?.type }
		});
		this.logger.log(`Channel soft-deleted: ${channelId}`);
	}

	async restore(channelId: string, userId: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		const snapshot = await this.channels.findById(channelId);
		if (!snapshot) throw new NotFoundException('Channel not found');
		if (!(snapshot as any).deleted) throw new ForbiddenException('Channel is not in trash');
		await this.channels.merge(channelId, {
			deleted: false,
			deleted_at: null,
			deleted_by: null,
			updated_at: new Date()
		});
		const restored = await this.channels.findById(channelId);
		// Re-broadcast as CHANNEL_CREATE so every client puts it back in the sidebar
		this.gateway?.emitToServer(serverId, { op: WsOp.CHANNEL_CREATE, d: restored });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_restore',
			targetKind: 'channel',
			targetId: channelId,
			channelId,
			metadata: { name: (snapshot as any)?.name }
		});
		this.logger.log(`Channel restored: ${channelId}`);
		return restored;
	}

	async hardDelete(channelId: string, userId: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		const snapshot = await this.channels.findById(channelId);
		if (!snapshot) throw new NotFoundException('Channel not found');
		if (!(snapshot as any).deleted)
			throw new ForbiddenException('Channel must be in trash before hard delete');
		const id = stringToRecordId.decode(channelId);
		const message_count = await this.messages.count({ channel_id: id });
		await Promise.all([
			this.messages.deleteWhere({ channel_id: id }),
			this.reactions.deleteWhere({ channel_id: id }),
			this.pins.deleteWhere({ channel_id: id }),
			this.readStates.deleteWhere({ channel_id: id })
		]);
		await this.channels.delete(channelId);
		// No CHANNEL_DELETE rebroadcast — clients already removed it on soft-delete
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_hard_delete',
			targetKind: 'channel',
			targetId: channelId,
			channelId,
			metadata: { name: (snapshot as any)?.name, type: (snapshot as any)?.type, message_count }
		});
		this.logger.log(`Channel hard-deleted: ${channelId} (${message_count} messages purged)`);
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
			deleted: false,
			created_at: now,
			updated_at: now
		});
		this.gateway?.emitToServer(serverId, { op: WsOp.CHANNEL_CREATE, d: channel });
		const newChannelId = stringToRecordId.encode((channel as any).id);
		await this.audit.record({
			serverId,
			actorId: createdBy,
			action: 'channel_create',
			targetKind: 'channel',
			targetId: newChannelId,
			channelId: newChannelId,
			metadata: { name, type }
		});
		return channel;
	}

	async findDMChannels(userId: string) {
		const myParticipations = await this.participants.findMany({ user_id: userId });
		if (!myParticipations.length) return [];

		const channelIds = myParticipations.map((p) => (p as any).channel_id as RecordId);
		const all = await this.channels.findByIds(channelIds);
		const dms = all
			.filter((c) => (c as any).type === 'direct' || (c as any).type === 'group')
			.sort((a, b) => {
				const aTime = new Date((a as any).last_message_at ?? 0).getTime();
				const bTime = new Date((b as any).last_message_at ?? 0).getTime();
				return bTime - aTime;
			});
		if (!dms.length) return dms;

		// Enrich each DM with `other_user_id` (for direct) + is_blocked / is_ignored
		// booleans so the client can route them between the main list and the
		// Ignored tab + decide which to surface with a "new messages blocked"
		// banner. Cheap: DM counts are small. Also attach `other_user_instance_url`
		// so the client can resolve the federated profile without an extra
		// roundtrip — the relations store may not know this DID if no
		// friendship/block/ignore exists between the pair.
		const snapshot = await this.relations.relationsFor(userId);
		const blocked = new Set(snapshot.blocked);
		const ignored = new Set(snapshot.ignored);

		const enriched = await Promise.all(
			dms.map(async (c) => {
				const channelRef = (c as any).id as RecordId;
				const parts = await this.participants.findMany({ channel_id: channelRef });
				const others = parts
					.map((p) => (p as any).user_id as string)
					.filter((u) => u !== userId);
				const other_user_id = (c as any).type === 'direct' ? (others[0] ?? null) : null;
				return {
					...(c as any),
					other_user_id,
					is_blocked: other_user_id ? blocked.has(other_user_id) : false,
					is_ignored: other_user_id ? ignored.has(other_user_id) : false
				};
			})
		);

		const otherDids = [
			...new Set(
				enriched
					.map((c) => c.other_user_id as string | null)
					.filter((d): d is string => !!d)
			)
		];
		if (!otherDids.length) return enriched;

		const allUsers = await this.users.findMany();
		const instanceByDid = new Map<string, string>(
			allUsers
				.filter((u) => otherDids.includes((u as any).did as string))
				.map((u) => [(u as any).did as string, (u as any).syr_instance_url as string])
		);
		return enriched.map((c) => ({
			...c,
			other_user_instance_url: c.other_user_id ? instanceByDid.get(c.other_user_id) ?? null : null
		}));
	}

	async createDM(userId: string, otherUserId: string, syrInstanceUrl?: string) {
		if (userId === otherUserId) throw new ForbiddenException('Cannot DM yourself');

		// Auto-create stub user row if the target hasn't logged into syren but
		// the caller provided their instance URL (from the resolve endpoint).
		const existing = await this.users.findOne({ did: otherUserId });
		if (!existing && syrInstanceUrl) {
			const now = new Date();
			await this.users.create({ did: otherUserId, syr_instance_url: syrInstanceUrl, created_at: now, updated_at: now } as any);
		}

		// DM policy + block gate — reject before even looking up / creating the channel.
		const check = await this.relations.canDM(userId, otherUserId);
		if (!check.allowed) {
			const msg =
				check.reason === 'dm_closed'
					? 'This user is not accepting direct messages'
					: check.reason === 'dm_friends_only'
						? 'This user is only accepting messages from friends'
						: 'You cannot message this user';
			throw new ForbiddenException(msg);
		}

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

		// Push-notify both participants so their DM lists update in real time.
		this.gateway?.emitToUser(userId, { op: WsOp.DM_CHANNEL_CREATE, d: channel });
		this.gateway?.emitToUser(otherUserId, { op: WsOp.DM_CHANNEL_CREATE, d: channel });

		return channel;
	}
}
