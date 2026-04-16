import { Injectable, Inject, Optional, Logger, ForbiddenException } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, stringToRecordId } from '@syren/types';
import { EmbedService } from '../embed/embed.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { ChannelRepository, ChannelParticipantRepository } from '../channel/channel.repository';
import { UserRepository } from '../auth/user.repository';
import { RoleService } from '../role/role.service';
import { RelationService } from '../relation/relation.service';
import { AuditLogService } from '../audit-log/audit-log.service';
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
		private readonly participants: ChannelParticipantRepository,
		private readonly users: UserRepository,
		private readonly roleService: RoleService,
		private readonly relations: RelationService,
		private readonly audit: AuditLogService,
		@Optional() private readonly embedService?: EmbedService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	/**
	 * Mask a message row for a caller who lacks `VIEW_REMOVED_MESSAGES`.
	 * Only applies when the message is soft-deleted. Keeps id, sender,
	 * timestamps, and the `deleted*` fields so the UI can render a
	 * placeholder. Drops user-visible content + attachments + embeds.
	 */
	private maskIfDeleted<T extends Record<string, any>>(row: T, reveal: boolean): T {
		if (!row?.deleted) return row;
		if (reveal) return row;
		return {
			...row,
			content: '',
			attachments: [],
			embeds: [],
			reactions: []
		} as T;
	}

	private async canRevealRemoved(userId: string | undefined, serverId: string | null, channelId?: string): Promise<boolean> {
		if (!userId || !serverId) return false;
		return this.roleService.hasPermission(
			userId,
			serverId,
			Permissions.VIEW_REMOVED_MESSAGES,
			channelId
		);
	}

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

	/**
	 * Moderation-view helper: paginated messages by one sender across every
	 * channel in the server, newest first. Includes `channel_name` on each row
	 * so the UI doesn't have to look it up separately.
	 */
	async findBySender(
		serverId: string,
		senderId: string,
		options: { limit?: number; offset?: number; before?: string; q?: string } = {},
		actorUserId?: string
	): Promise<{ items: any[]; total: number }> {
		const limit = Math.min(options.limit ?? 50, 200);
		const offset = options.offset ?? 0;
		const serverRef = stringToRecordId.decode(serverId);

		const channels = await this.channels.findMany({ server_id: serverRef });
		if (!channels.length) return { items: [], total: 0 };

		const channelIds = channels.map((c) => (c as any).id as RecordId);
		const nameByChannel = new Map<string, string>(
			channels.map((c) => [stringToRecordId.encode((c as any).id as RecordId), (c as any).name as string])
		);

		const db = (this.messages as any).db;
		const bindings: Record<string, unknown> = {
			sender: senderId,
			channels: channelIds
		};
		const where = ['sender_id = $sender', 'channel_id IN $channels'];
		if (options.before) {
			bindings.before = new Date(options.before);
			where.push('created_at < $before');
		}
		if (options.q?.trim()) {
			bindings.q = options.q.trim().toLowerCase();
			where.push('string::lowercase(content) CONTAINS $q');
		}
		const whereSql = `WHERE ${where.join(' AND ')}`;

		// One query: fetch the full matching set (sorted), compute total from its
		// length, slice the requested page. A separate `count() GROUP ALL` query
		// was returning the wrong total on some SurrealDB versions, and the
		// moderation-view scale (typically < a few thousand messages per user
		// per server) doesn't justify the extra query anyway.
		const allResult = (await db.query(
			`SELECT * FROM message ${whereSql} ORDER BY created_at DESC`,
			bindings
		)) as any[];
		const allRows = (allResult[0] ?? []) as any[];
		const total = allRows.length;
		const pageRows = allRows.slice(offset, offset + limit);

		const enriched = await this.enrich(pageRows as any);
		const reveal = await this.canRevealRemoved(actorUserId, serverId);
		const withChannel = enriched.map((m) => {
			const row = this.maskIfDeleted(m as any, reveal);
			return {
				...row,
				channel_name: nameByChannel.get(stringToRecordId.encode((row as any).channel_id as RecordId)) ?? null
			};
		});
		return { items: withChannel, total };
	}

	/**
	 * Trash view: paginated soft-deleted messages across every channel in the
	 * server. Callers hold `VIEW_TRASH` (enforced at the route) so content is
	 * returned raw — masking is for regular readers, not trash operators.
	 * Includes `channel_name` on each row for the UI.
	 */
	async findTrashedInServer(
		serverId: string,
		options: {
			limit?: number;
			offset?: number;
			q?: string;
			before?: string;
			sender_id?: string;
			deleted_by?: string;
			since?: Date;
			until?: Date;
		} = {}
	): Promise<{ items: any[]; total: number }> {
		const limit = Math.min(options.limit ?? 50, 200);
		const offset = options.offset ?? 0;
		const serverRef = stringToRecordId.decode(serverId);

		// Include trashed channels too — a soft-deleted message inside a live
		// channel AND a message inside a soft-deleted channel are both valid
		// trash targets. Restore of the message is independent of the channel's
		// state; hard-delete tears down the message row only.
		const channels = await this.channels.findMany({ server_id: serverRef });
		if (!channels.length) return { items: [], total: 0 };

		const channelIds = channels.map((c) => (c as any).id as RecordId);
		const nameByChannel = new Map<string, string>(
			channels.map((c) => [
				stringToRecordId.encode((c as any).id as RecordId),
				(c as any).name as string
			])
		);

		const db = (this.messages as any).db;
		const bindings: Record<string, unknown> = {
			channels: channelIds
		};
		const where = ['channel_id IN $channels', 'deleted = true'];
		if (options.before) {
			bindings.before = new Date(options.before);
			where.push('deleted_at < $before');
		}
		if (options.q?.trim()) {
			bindings.q = options.q.trim().toLowerCase();
			where.push('string::lowercase(content) CONTAINS $q');
		}
		if (options.sender_id?.trim()) {
			bindings.sender = options.sender_id.trim().toLowerCase();
			where.push('string::lowercase(sender_id) CONTAINS $sender');
		}
		if (options.deleted_by?.trim()) {
			bindings.deleter = options.deleted_by.trim().toLowerCase();
			where.push('string::lowercase(deleted_by) CONTAINS $deleter');
		}
		if (options.since) {
			bindings.since = options.since;
			where.push('deleted_at >= $since');
		}
		if (options.until) {
			bindings.until = options.until;
			where.push('deleted_at <= $until');
		}
		const whereSql = `WHERE ${where.join(' AND ')}`;

		// Match findBySender: single fetch + slice. Avoids SurrealDB GROUP ALL quirk.
		const allResult = (await db.query(
			`SELECT * FROM message ${whereSql} ORDER BY deleted_at DESC`,
			bindings
		)) as any[];
		const allRows = (allResult[0] ?? []) as any[];
		const total = allRows.length;
		const pageRows = allRows.slice(offset, offset + limit);

		const enriched = await this.enrich(pageRows as any);
		const withChannel = enriched.map((m) => ({
			...(m as any),
			channel_name:
				nameByChannel.get(stringToRecordId.encode((m as any).channel_id as RecordId)) ?? null
		}));
		return { items: withChannel, total };
	}

	/**
	 * Quick totals for the moderation view header. Counts + min/max timestamps
	 * of a user's messages in every channel of the server.
	 */
	async statsForSender(serverId: string, senderId: string) {
		const serverRef = stringToRecordId.decode(serverId);
		const channels = await this.channels.findMany({ server_id: serverRef });
		if (!channels.length) {
			return { total: 0, first_at: null, last_at: null, per_channel: [] };
		}
		const channelIds = channels.map((c) => (c as any).id as RecordId);
		const db = (this.messages as any).db;

		const [aggResult, perChannelResult] = await Promise.all([
			db.query(
				`SELECT count() AS total, math::min(created_at) AS first_at, math::max(created_at) AS last_at FROM message WHERE sender_id = $sender AND channel_id IN $channels GROUP ALL`,
				{ sender: senderId, channels: channelIds }
			),
			db.query(
				`SELECT channel_id, count() AS count FROM message WHERE sender_id = $sender AND channel_id IN $channels GROUP BY channel_id`,
				{ sender: senderId, channels: channelIds }
			)
		]);

		const agg = ((aggResult as any)[0]?.[0] as any) ?? {};
		const perChannelRows = ((perChannelResult as any)[0] ?? []) as any[];
		const nameByChannel = new Map<string, string>(
			channels.map((c) => [stringToRecordId.encode((c as any).id as RecordId), (c as any).name as string])
		);

		return {
			total: (agg.total as number) ?? 0,
			first_at: agg.first_at ?? null,
			last_at: agg.last_at ?? null,
			per_channel: perChannelRows
				.map((r: any) => {
					const cid = stringToRecordId.encode(r.channel_id as RecordId);
					return { channel_id: cid, channel_name: nameByChannel.get(cid) ?? null, count: r.count as number };
				})
				.sort((a, b) => b.count - a.count)
		};
	}

	async findByChannel(
		channelId: string,
		options: { before?: string; limit?: number; includeDeleted?: boolean } = {},
		actorUserId?: string
	) {
		const limit = Math.min(options.limit || 50, 100);
		const channelRef = stringToRecordId.decode(channelId);

		const all = await this.messages.findMany(
			{ channel_id: channelRef },
			{ sort: { field: 'created_at', order: 'desc' }, limit }
		);
		const filtered = options.before
			? all.filter((m) => new Date((m as any).created_at).getTime() < new Date(options.before!).getTime())
			: all;

		// Viewer-aware deletion filter.
		// Callers who lack VIEW_REMOVED_MESSAGES, OR callers who have it but
		// didn't request include_deleted, get deleted rows stripped entirely —
		// the timeline looks seamless (Block 13). Masking preserved only for
		// privileged callers when they explicitly pass include_deleted.
		const serverId = await this.getServerIdForChannel(channelRef);
		const reveal = await this.canRevealRemoved(actorUserId, serverId, channelId);
		const includeDeleted = !!options.includeDeleted && reveal;
		const postDeletedFilter = includeDeleted
			? filtered
			: filtered.filter((m) => !(m as any).deleted);
		const enriched = await this.enrich(postDeletedFilter as any);
		// Even when includeDeleted is true for a privileged caller, run through
		// maskIfDeleted as a no-op safety (reveal=true means no mask). Cheap.
		const masked = enriched.map((m) => this.maskIfDeleted(m as any, reveal));
		return masked.reverse();
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

		// DM policy + block gate. Only applies to 1:1 DMs; group DMs skipped
		// in v1 (policy fan-out is complex). Group DMs are rare enough that
		// deferring the check doesn't create a safety hole — participants
		// voluntarily joined.
		const channel = await this.channels.findById(channelRef as any);
		if (channel && (channel as any).type === 'direct') {
			const parts = await this.participants.findMany({ channel_id: channelRef });
			const other = parts.find((p) => (p as any).user_id !== senderId) as any;
			if (other?.user_id) {
				const check = await this.relations.canDM(senderId, other.user_id);
				if (!check.allowed) {
					const msg =
						check.reason === 'dm_closed'
							? 'This user is not accepting direct messages'
							: check.reason === 'dm_friends_only'
								? 'This user is only accepting messages from friends'
								: 'You cannot message this user';
					throw new ForbiddenException(msg);
				}
			}
		}

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
		const senderId = (existing as any).sender_id as string;

		// Sender can always delete their own; otherwise need MANAGE_MESSAGES in the server.
		// Route-layer guard doesn't fit here (mixed identity) so the check stays inline.
		const serverId = await this.getServerIdForChannel(chId);
		if (!isOwn) {
			if (!serverId) throw new Error("Cannot delete others' messages");
			await this.roleService.requirePermission(actorUserId, serverId, Permissions.MANAGE_MESSAGES, chId);
		}

		const now = new Date();
		await this.messages.merge(messageId, {
			deleted: true,
			deleted_at: now,
			deleted_by: actorUserId,
			updated_at: now
		});

		if (this.gateway && serverId) {
			// Per-subscriber broadcast: privileged viewers get the full un-masked
			// row as MESSAGE_UPDATE (keeps the row visible + respects their local
			// `showRemoved` toggle). Everyone else gets a terminal MESSAGE_DELETE
			// — no leak of moderator identity, no "a deletion happened here"
			// signal in their WS stream. Seamless timeline for non-priv users.
			const subscribers = this.gateway.getChannelSubscribers(chId);
			if (subscribers.size > 0) {
				const updated = await this.messages.findById(messageId);
				const [enriched] = await this.enrich([updated as any]);
				const deleteEvent = {
					op: WsOp.MESSAGE_DELETE,
					d: { id: messageId, channel_id: chId }
				};
				const updateEvent = { op: WsOp.MESSAGE_UPDATE, d: enriched };
				await Promise.all(
					[...subscribers].map(async (uid) => {
						const canReveal = await this.roleService.hasPermission(
							uid,
							serverId,
							Permissions.VIEW_REMOVED_MESSAGES,
							chId
						);
						this.gateway!.emitToUser(uid, canReveal ? updateEvent : deleteEvent);
					})
				);
			}
		}

		// Audit only when a moderator deletes someone else's message.
		// Self-delete is not audit-worthy (akin to an edit).
		if (!isOwn && serverId) {
			await this.audit.record({
				serverId,
				actorId: actorUserId,
				action: 'message_delete',
				targetKind: 'message',
				targetId: messageId,
				targetUserId: senderId,
				channelId: chId,
				metadata: { channel_id: chId }
			});
		}
	}

	async restore(messageId: string, actorUserId: string) {
		const existing = await this.messages.findById(messageId);
		if (!existing) throw new Error('Message not found');
		if (!(existing as any).deleted) throw new Error('Message is not in trash');

		const chId = stringToRecordId.encode((existing as any).channel_id);
		const serverId = await this.getServerIdForChannel(chId);
		const senderId = (existing as any).sender_id as string;

		await this.messages.merge(messageId, {
			deleted: false,
			deleted_at: null,
			deleted_by: null,
			updated_at: new Date()
		});

		const restored = await this.messages.findById(messageId);
		const [enriched] = await this.enrich([restored as any]);

		if (this.gateway) {
			// Broadcast un-masked row so every client gets the content back.
			this.gateway.emitToChannel(chId, { op: WsOp.MESSAGE_UPDATE, d: enriched });
		}

		if (serverId) {
			await this.audit.record({
				serverId,
				actorId: actorUserId,
				action: 'message_restore',
				targetKind: 'message',
				targetId: messageId,
				targetUserId: senderId,
				channelId: chId,
				metadata: { channel_id: chId }
			});
		}
		return enriched;
	}

	async hardDelete(messageId: string, actorUserId: string) {
		const existing = await this.messages.findById(messageId);
		if (!existing) throw new Error('Message not found');
		if (!(existing as any).deleted)
			throw new Error('Message must be in trash before hard delete');

		const chId = stringToRecordId.encode((existing as any).channel_id);
		const serverId = await this.getServerIdForChannel(chId);
		const senderId = (existing as any).sender_id as string;
		const contentLength = ((existing as any).content as string | undefined)?.length ?? 0;

		const msgRef = stringToRecordId.decode(messageId);
		await Promise.all([
			this.reactions.deleteWhere({ message_id: msgRef }),
			this.pins.deleteWhere({ message_id: msgRef })
		]);
		await this.messages.delete(messageId);

		if (this.gateway) {
			this.gateway.emitToChannel(chId, {
				op: WsOp.MESSAGE_DELETE,
				d: { id: messageId, channel_id: chId }
			});
		}

		if (serverId) {
			await this.audit.record({
				serverId,
				actorId: actorUserId,
				action: 'message_hard_delete',
				targetKind: 'message',
				targetId: messageId,
				targetUserId: senderId,
				channelId: chId,
				metadata: { channel_id: chId, sender_id: senderId, content_length: contentLength }
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
		// Permission enforced at route layer via `@RequirePermission('MANAGE_MESSAGES')`.
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
		// Permission enforced at route layer via `@RequirePermission('MANAGE_MESSAGES')`.
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

	async findPinned(
		channelId: string,
		options: { includeDeleted?: boolean } = {},
		actorUserId?: string
	) {
		const channelRef = stringToRecordId.decode(channelId);
		const pins = await this.pins.findMany(
			{ channel_id: channelRef },
			{ sort: { field: 'pinned_at', order: 'desc' } }
		);
		if (!pins.length) return [];

		const messageIds = pins.map((p) => (p as any).message_id as RecordId);
		const messages = await this.messages.findByIds(messageIds);

		// Same viewer-aware filter as findByChannel.
		const serverId = await this.getServerIdForChannel(channelRef);
		const reveal = await this.canRevealRemoved(actorUserId, serverId, channelId);
		const includeDeleted = !!options.includeDeleted && reveal;
		const filtered = includeDeleted
			? messages
			: messages.filter((m) => !(m as any).deleted);
		return filtered.map((m) => this.maskIfDeleted(m as any, reveal));
	}
}
