import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, stringToRecordId } from '@syren/types';
import { EmbedService } from '../embed/embed.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { ChannelRepository } from '../channel/channel.repository';
import { UserRepository } from '../auth/user.repository';
import { RoleService } from '../role/role.service';
import {
	MessageRepository,
	MessageReactionRepository,
	PinnedMessageRepository
} from './message.repository';

@Injectable()
export class MessageService {
	private readonly logger = new Logger(MessageService.name);

	constructor(
		private readonly messages: MessageRepository,
		private readonly reactions: MessageReactionRepository,
		private readonly pins: PinnedMessageRepository,
		private readonly channels: ChannelRepository,
		private readonly users: UserRepository,
		private readonly roleService: RoleService,
		@Optional() private readonly embedService?: EmbedService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	private async getServerIdForChannel(channelRef: RecordId | string): Promise<string | null> {
		const channel = await this.channels.findById(channelRef as any);
		if (!channel) return null;
		const sid = (channel as any).server_id;
		return sid ? stringToRecordId.encode(sid) : null;
	}

	/**
	 * Attach `sender_instance_url` to each message so clients can resolve the
	 * sender's profile directly from their syr instance. No profile data is
	 * stored or returned by syren itself.
	 */
	private async enrich<T extends { sender_id?: string }>(msgs: T[]): Promise<(T & { sender_instance_url?: string })[]> {
		if (!msgs.length) return msgs as any;
		const dids = [...new Set(msgs.map((m) => m.sender_id).filter(Boolean) as string[])];
		const users = await this.users.findMany();
		const instanceByDid = new Map<string, string>(
			users
				.filter((u) => dids.includes((u as any).did as string))
				.map((u) => [(u as any).did as string, (u as any).syr_instance_url as string])
		);
		return msgs.map((m) => ({
			...m,
			sender_instance_url: m.sender_id ? instanceByDid.get(m.sender_id) : undefined
		}));
	}

	async findByChannel(channelId: string, options: { before?: string; limit?: number } = {}) {
		const limit = Math.min(options.limit || 50, 100);
		const channelRef = stringToRecordId.decode(channelId);

		const all = await this.messages.findMany(
			{ channel_id: channelRef },
			{ sort: { field: 'created_at', order: 'desc' }, limit }
		);
		const filtered = options.before
			? all.filter((m) => new Date((m as any).created_at).getTime() < new Date(options.before!).getTime())
			: all;
		const enriched = await this.enrich(filtered as any);
		return enriched.reverse();
	}

	async create(
		channelId: string,
		senderId: string,
		content: string,
		replyTo: string[] = [],
		attachments: Array<{
			url: string;
			filename: string;
			mime_type: string;
			size: number;
			width?: number;
			height?: number;
		}> = []
	) {
		const now = new Date();
		const channelRef = stringToRecordId.decode(channelId);
		// Dedupe, cap at 5, decode each into a RecordId reference
		const seen = new Set<string>();
		const replyRefs: RecordId[] = [];
		for (const id of replyTo) {
			if (!id || seen.has(id)) continue;
			seen.add(id);
			replyRefs.push(stringToRecordId.decode(id));
			if (replyRefs.length >= 5) break;
		}

		const message = await this.messages.create({
			channel_id: channelRef,
			sender_id: senderId,
			type: 'text',
			content,
			attachments,
			embeds: [],
			pinned: false,
			reply_to: replyRefs,
			created_at: now,
			updated_at: now
		});

		await this.channels.merge(channelRef, { last_message_at: now });

		const [enriched] = await this.enrich([message as any]);

		if (this.gateway) {
			this.gateway.emitToChannel(channelId, { op: WsOp.MESSAGE_CREATE, d: enriched });
		}

		if (this.embedService) {
			this.embedService.resolveFromContent(content).then(async (embeds) => {
				if (embeds.length > 0 && (message as any).id) {
					const updated = await this.messages.merge((message as any).id as RecordId, {
						embeds,
						updated_at: new Date()
					});
					const [updEnriched] = await this.enrich([updated as any]);
					this.gateway?.emitToChannel(channelId, { op: WsOp.MESSAGE_UPDATE, d: updEnriched });
				}
			}).catch(() => {});
		}

		return enriched;
	}

	async update(messageId: string, senderId: string, content: string) {
		const existing = await this.messages.findById(messageId);
		if (!existing) throw new Error('Message not found');
		if ((existing as any).sender_id !== senderId) throw new Error("Cannot edit others' messages");

		const updated = await this.messages.merge(messageId, {
			content,
			edited_at: new Date(),
			updated_at: new Date()
		});
		const [enriched] = await this.enrich([updated as any]);

		if (this.gateway) {
			const chId = stringToRecordId.encode((existing as any).channel_id);
			this.gateway.emitToChannel(chId, { op: WsOp.MESSAGE_UPDATE, d: enriched });
		}
		return enriched;
	}

	async clearEmbeds(messageId: string, senderId: string) {
		const existing = await this.messages.findById(messageId);
		if (!existing) throw new Error('Message not found');
		if ((existing as any).sender_id !== senderId) throw new Error('Only sender can remove embeds');

		const updated = await this.messages.merge(messageId, {
			embeds: [],
			updated_at: new Date()
		});
		const [enriched] = await this.enrich([updated as any]);

		if (this.gateway) {
			const chId = stringToRecordId.encode((existing as any).channel_id);
			this.gateway.emitToChannel(chId, { op: WsOp.MESSAGE_UPDATE, d: enriched });
		}
		return enriched;
	}

	async delete(messageId: string, actorUserId: string) {
		const existing = await this.messages.findById(messageId);
		if (!existing) throw new Error('Message not found');

		const chId = stringToRecordId.encode((existing as any).channel_id);
		const isOwn = (existing as any).sender_id === actorUserId;

		// Sender can always delete their own; otherwise need MANAGE_MESSAGES in the server
		if (!isOwn) {
			const serverId = await this.getServerIdForChannel(chId);
			if (!serverId) throw new Error("Cannot delete others' messages");
			await this.roleService.requirePermission(actorUserId, serverId, Permissions.MANAGE_MESSAGES);
		}

		await this.messages.delete(messageId);

		if (this.gateway) {
			this.gateway.emitToChannel(chId, {
				op: WsOp.MESSAGE_DELETE,
				d: { id: messageId, channel_id: chId }
			});
		}
	}

	async addReaction(channelId: string, messageId: string, userId: string, kind: string, value: string, imageUrl?: string) {
		const now = new Date();
		const msgRef = stringToRecordId.decode(messageId);

		await this.reactions.create({
			message_id: msgRef,
			user_id: userId,
			kind,
			value,
			image_url: imageUrl ?? null,
			created_at: now,
			updated_at: now
		});

		if (this.gateway) {
			this.gateway.emitToChannel(channelId, {
				op: WsOp.REACTION_ADD,
				d: { message_id: messageId, user_id: userId, kind, value, image_url: imageUrl }
			});
		}
	}

	async removeReaction(channelId: string, messageId: string, userId: string, value: string) {
		const msgRef = stringToRecordId.decode(messageId);
		await this.reactions.deleteWhere({ message_id: msgRef, user_id: userId, value });

		if (this.gateway) {
			this.gateway.emitToChannel(channelId, {
				op: WsOp.REACTION_REMOVE,
				d: { message_id: messageId, user_id: userId, value }
			});
		}
	}

	async pin(channelId: string, messageId: string, pinnedBy: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		if (serverId) {
			await this.roleService.requirePermission(pinnedBy, serverId, Permissions.MANAGE_MESSAGES);
		}

		const now = new Date();
		const channelRef = stringToRecordId.decode(channelId);
		const msgRef = stringToRecordId.decode(messageId);

		await this.pins.create({
			channel_id: channelRef,
			message_id: msgRef,
			pinned_by: pinnedBy,
			pinned_at: now,
			created_at: now,
			updated_at: now
		});

		await this.messages.merge(msgRef, { pinned: true, updated_at: now });

		if (this.gateway) {
			this.gateway.emitToChannel(channelId, {
				op: WsOp.PIN_ADD,
				d: {
					message_id: messageId,
					channel_id: channelId,
					pinned_by: pinnedBy,
					pinned_at: now.toISOString()
				}
			});
		}
	}

	async unpin(channelId: string, messageId: string, actorUserId: string) {
		const serverId = await this.getServerIdForChannel(channelId);
		if (serverId) {
			await this.roleService.requirePermission(actorUserId, serverId, Permissions.MANAGE_MESSAGES);
		}

		const channelRef = stringToRecordId.decode(channelId);
		const msgRef = stringToRecordId.decode(messageId);

		await this.pins.deleteWhere({ channel_id: channelRef, message_id: msgRef });
		await this.messages.merge(msgRef, { pinned: false, updated_at: new Date() });

		if (this.gateway) {
			this.gateway.emitToChannel(channelId, {
				op: WsOp.PIN_REMOVE,
				d: { message_id: messageId, channel_id: channelId }
			});
		}
	}

	async findPinned(channelId: string) {
		const channelRef = stringToRecordId.decode(channelId);
		const pins = await this.pins.findMany(
			{ channel_id: channelRef },
			{ sort: { field: 'pinned_at', order: 'desc' } }
		);
		if (!pins.length) return [];

		const messageIds = pins.map((p) => (p as any).message_id as RecordId);
		return this.messages.findByIds(messageIds);
	}
}
