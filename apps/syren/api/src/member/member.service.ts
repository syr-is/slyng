import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, WsOp, stringToRecordId } from '@syren/types';
import { ServerRepository, ServerMemberRepository, ServerRoleRepository, ServerBanRepository } from '../server/server.repository';
import { ChannelRepository, ChannelReadStateRepository } from '../channel/channel.repository';
import { MessageRepository } from '../message/message.repository';
import { UserRepository } from '../auth/user.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import { randomUUID } from 'node:crypto';

const ALL_PERMISSION_COUNT = Object.keys(Permissions).length;

function popcount(n: bigint): number {
	let c = 0;
	let x = n;
	while (x > 0n) {
		if (x & 1n) c++;
		x >>= 1n;
	}
	return c;
}

/** ADMINISTRATOR bit implies all abilities — surface that in the sort count. */
function effectivePermCount(p: bigint): number {
	if ((p & Permissions.ADMINISTRATOR) === Permissions.ADMINISTRATOR) return ALL_PERMISSION_COUNT;
	return popcount(p);
}

@Injectable()
export class MemberService {
	private readonly logger = new Logger(MemberService.name);

	constructor(
		private readonly members: ServerMemberRepository,
		private readonly readStates: ChannelReadStateRepository,
		private readonly users: UserRepository,
		private readonly roles: ServerRoleRepository,
		private readonly servers: ServerRepository,
		private readonly bans: ServerBanRepository,
		private readonly channels: ChannelRepository,
		private readonly messages: MessageRepository,
		private readonly roleService: RoleService,
		private readonly audit: AuditLogService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async kick(
		serverId: string,
		targetUserId: string,
		actorUserId: string,
		opts: { deleteMessageSeconds?: number } = {}
	) {
		const server = await this.servers.findById(serverId);
		if (!server) throw new Error('Server not found');
		if ((server as any).owner_id === targetUserId) throw new Error('Cannot kick the server owner');
		if (targetUserId === actorUserId) throw new Error('Cannot kick yourself');
		// Permission is enforced at the route layer via `@RequirePermission('KICK_MEMBERS')`.

		const ref = stringToRecordId.decode(serverId);
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (!member) throw new Error('Member not found');

		await this.members.delete((member as any).id);
		await this.servers.merge(serverId, {
			member_count: Math.max(0, ((server as any).member_count ?? 1) - 1)
		});

		if (opts.deleteMessageSeconds !== undefined) {
			await this.purgeMessages(serverId, targetUserId, opts.deleteMessageSeconds, actorUserId);
		}

		this.gateway?.emitToServer(serverId, {
			op: WsOp.MEMBER_REMOVE,
			d: { server_id: serverId, user_id: targetUserId }
		});
		await this.evictFromServer(serverId, targetUserId);
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'member_kick',
			targetKind: 'member',
			targetId: targetUserId,
			targetUserId,
			metadata: { delete_seconds: opts.deleteMessageSeconds ?? 0 }
		});
		this.logger.log(`Member kicked: ${targetUserId} from ${serverId} by ${actorUserId}`);
	}

	/**
	 * Ban = kick + persist server_ban row + optional message purge. Banned
	 * users are blocked at `joinByInvite`; unban lifts the block.
	 */
	async ban(
		serverId: string,
		targetUserId: string,
		actorUserId: string,
		opts: { reason?: string; deleteMessageSeconds?: number } = {}
	) {
		const server = await this.servers.findById(serverId);
		if (!server) throw new Error('Server not found');
		if ((server as any).owner_id === targetUserId) throw new Error('Cannot ban the server owner');
		if (targetUserId === actorUserId) throw new Error('Cannot ban yourself');
		// Permission is enforced at the route layer via `@RequirePermission('BAN_MEMBERS')`.

		const ref = stringToRecordId.decode(serverId);
		const now = new Date();

		// Remove existing membership if any (silent if already out of server)
		const member = await this.members.findOne({ server_id: ref, user_id: targetUserId });
		if (member) {
			await this.members.delete((member as any).id);
			await this.servers.merge(serverId, {
				member_count: Math.max(0, ((server as any).member_count ?? 1) - 1)
			});
		}

		// Each ban is its own audit-log row. Deactivate any older active row
		// (from a previous, uncleared session), then insert a fresh one — the
		// history is then visible via the moderation view.
		const activeRows = await this.bans.findMany({
			server_id: ref,
			user_id: targetUserId,
			active: true
		});
		for (const r of activeRows) {
			await this.bans.merge((r as any).id, {
				active: false,
				unbanned_at: now,
				unbanned_by: actorUserId,
				updated_at: now
			});
		}
		await this.bans.create({
			server_id: ref,
			user_id: targetUserId,
			banned_by: actorUserId,
			banned_at: now,
			reason: opts.reason ?? null,
			active: true,
			created_at: now,
			updated_at: now
		});

		if (opts.deleteMessageSeconds !== undefined) {
			await this.purgeMessages(serverId, targetUserId, opts.deleteMessageSeconds, actorUserId);
		}

		if (member) {
			this.gateway?.emitToServer(serverId, {
				op: WsOp.MEMBER_REMOVE,
				d: { server_id: serverId, user_id: targetUserId }
			});
		}
		await this.evictFromServer(serverId, targetUserId);
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'member_ban',
			targetKind: 'member',
			targetId: targetUserId,
			targetUserId,
			reason: opts.reason,
			metadata: { delete_seconds: opts.deleteMessageSeconds ?? 0 }
		});
		this.logger.log(`Member banned: ${targetUserId} from ${serverId} by ${actorUserId}`);
	}

	/**
	 * After kick/ban: yank the victim's WS topic subscriptions for this
	 * server and kick them out of any voice channel they were in. This
	 * runs alongside the MEMBER_REMOVE broadcast so the victim's other
	 * tabs stop receiving events immediately, not at next navigation.
	 */
	private async evictFromServer(serverId: string, targetUserId: string) {
		if (!this.gateway) return;
		const serverRef = stringToRecordId.decode(serverId);
		const channels = await this.channels.findMany({ server_id: serverRef });
		const channelIds = channels.map((c) => stringToRecordId.encode((c as any).id));
		await this.gateway.evictUserFromServer(targetUserId, serverId, channelIds);
	}

	async unban(serverId: string, targetUserId: string, actorUserId: string) {
		// Permission enforced at the route layer via `@RequirePermission('BAN_MEMBERS')`.
		const ref = stringToRecordId.decode(serverId);
		const activeRows = await this.bans.findMany({
			server_id: ref,
			user_id: targetUserId,
			active: true
		});
		if (!activeRows.length) throw new Error('User is not banned');
		const now = new Date();
		for (const r of activeRows) {
			await this.bans.merge((r as any).id, {
				active: false,
				unbanned_at: now,
				unbanned_by: actorUserId,
				updated_at: now
			});
		}
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'member_unban',
			targetKind: 'member',
			targetId: targetUserId,
			targetUserId
		});
		this.logger.log(`Member unbanned: ${targetUserId} from ${serverId} by ${actorUserId}`);
	}

	/** Return true if the user is banned from this server. Called during join. */
	async isBanned(serverId: string, userId: string): Promise<boolean> {
		const ref = stringToRecordId.decode(serverId);
		const existing = await this.bans.findOne({
			server_id: ref,
			user_id: userId,
			active: true
		});
		return !!existing;
	}

	/** Audit log: all ban rows (active + inactive) for a user in a server, newest first. */
	async findBanHistoryForUser(serverId: string, userId: string) {
		const ref = stringToRecordId.decode(serverId);
		const rows = await this.bans.findMany(
			{ server_id: ref, user_id: userId },
			{ sort: { field: 'banned_at', order: 'desc' } }
		);
		return rows;
	}

	/** Public wrapper so controllers can invoke bulk-purge without a kick/ban. */
	async purgeMessagesPublic(
		serverId: string,
		targetUserId: string,
		deleteSeconds: number,
		actorUserId: string
	): Promise<void> {
		await this.purgeMessages(serverId, targetUserId, deleteSeconds, actorUserId);
	}

	/**
	 * Delete messages sent by `userId` in every channel of `serverId` newer
	 * than `sinceSeconds` ago. Pass `sinceSeconds = 0` to skip purge entirely,
	 * a positive number for a sliding window, or `Number.POSITIVE_INFINITY`
	 * / a huge value to purge everything this user has ever posted in the
	 * server.
	 */
	private async purgeMessages(
		serverId: string,
		userId: string,
		sinceSeconds: number,
		actorUserId?: string
	) {
		if (!sinceSeconds || sinceSeconds <= 0) return;
		const cutoff = Number.isFinite(sinceSeconds)
			? new Date(Date.now() - sinceSeconds * 1000)
			: new Date(0);

		const serverRef = stringToRecordId.decode(serverId);
		const channels = await this.channels.findMany({ server_id: serverRef });
		if (!channels.length) return;

		const db = (this.messages as any).db;
		const actor = actorUserId ?? userId; // fallback if caller didn't pass one
		const batchId = randomUUID();
		const now = new Date();
		let totalPurged = 0;

		for (const channel of channels) {
			const channelRef = (channel as any).id as RecordId;
			const channelIdStr = stringToRecordId.encode(channelRef);
			// Soft-delete via UPDATE ... RETURN BEFORE. Rows stay in the table;
			// `deleted=true` marks them, `deleted_by` + `deleted_at` record the
			// context. Clients without VIEW_REMOVED_MESSAGES see a placeholder.
			const result = (await db.query(
				`UPDATE message SET deleted = true, deleted_at = $now, deleted_by = $actor, updated_at = $now WHERE channel_id = $ch AND sender_id = $uid AND created_at > $cutoff AND (deleted = NONE OR deleted = false) RETURN BEFORE`,
				{ ch: channelRef, uid: userId, cutoff, actor, now }
			)) as any[];
			const rows = (result[0] ?? []) as any[];
			totalPurged += rows.length;

			for (const row of rows) {
				const messageId = stringToRecordId.encode(row.id as RecordId);
				// Masked WS broadcast — never leak removed content.
				this.gateway?.emitToChannel(channelIdStr, {
					op: WsOp.MESSAGE_UPDATE,
					d: {
						id: messageId,
						channel_id: channelIdStr,
						deleted: true,
						deleted_at: now.toISOString(),
						deleted_by: actor,
						content: '',
						attachments: [],
						embeds: [],
						reactions: []
					}
				});

				// One audit row per purged message — all share the same batch_id
				// so the UI can collapse "N messages purged" into one card.
				await this.audit.record({
					serverId,
					actorId: actor,
					action: 'message_purge',
					targetKind: 'message',
					targetId: messageId,
					targetUserId: userId,
					batchId,
					metadata: {
						channel_id: channelIdStr,
						cutoff: cutoff.toISOString()
					}
				});
			}
		}
		this.logger.log(
			`Purged ${totalPurged} messages for ${userId} in ${serverId} since ${cutoff.toISOString()} (batch=${batchId.slice(0, 8)})`
		);
	}

	async listBans(
		serverId: string,
		actorUserId: string,
		options: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
	) {
		// Permission enforced at route layer via `@RequirePermission('BAN_MEMBERS')`.
		const ref = stringToRecordId.decode(serverId);

		const sortField = options.sort && ['banned_at', 'user_id'].includes(options.sort)
			? options.sort
			: 'banned_at';
		const sortOrder: 'asc' | 'desc' = options.order === 'asc' ? 'asc' : 'desc';

		const { items, total } = await this.bans.findPage(
			{ server_id: ref, active: true },
			{
				sort: { field: sortField, order: sortOrder },
				limit: options.limit,
				offset: options.offset,
				search: options.q ? { fields: ['user_id', 'reason'] as any, query: options.q } : undefined
			}
		);

		// Enrich with syr_instance_url so client can render avatars / names
		const userIds = [...new Set(items.map((b) => (b as any).user_id as string))];
		const users = await this.users.findMany();
		const instanceMap = new Map<string, string>(
			users
				.filter((u) => userIds.includes((u as any).did as string))
				.map((u) => [(u as any).did as string, (u as any).syr_instance_url as string])
		);

		return {
			items: items.map((b) => ({
				...b,
				syr_instance_url: instanceMap.get((b as any).user_id as string)
			})),
			total
		};
	}

	async findByServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		const members = await this.members.findMany(
			{ server_id: ref },
			{ sort: { field: 'joined_at', order: 'asc' } }
		);
		return this.enrichMembers(ref, members);
	}

	async findPageForServer(
		serverId: string,
		options: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
	): Promise<{ items: any[]; total: number }> {
		const ref = stringToRecordId.decode(serverId);

		const sortField = options.sort && ['joined_at', 'user_id', 'permissions'].includes(options.sort)
			? options.sort
			: 'joined_at';
		const sortOrder: 'asc' | 'desc' = options.order === 'desc' ? 'desc' : 'asc';
		const limit = Math.min(options.limit ?? 50, 200);
		const offset = options.offset ?? 0;
		const searchSpec = options.q ? { fields: ['user_id', 'nickname'], query: options.q } : undefined;

		// Sort by effective permission count requires fully-enriched rows
		// (role_ids → OR of role.permissions). Do the filter + full fetch on
		// the DB side, then enrich + sort + slice in memory. For any other
		// sort, DB pagination is fine — we only enrich the current page.
		if (sortField === 'permissions') {
			const all = await this.members.findMany(
				{ server_id: ref },
				{ sort: { field: 'joined_at', order: 'asc' }, search: searchSpec }
			);
			const enriched = await this.enrichMembers(ref, all);
			enriched.sort((a, b) => {
				const diff = (a.permission_count ?? 0) - (b.permission_count ?? 0);
				return sortOrder === 'desc' ? -diff : diff;
			});
			return {
				items: enriched.slice(offset, offset + limit),
				total: enriched.length
			};
		}

		const { items, total } = await this.members.findPage(
			{ server_id: ref },
			{
				sort: { field: sortField, order: sortOrder },
				limit,
				offset,
				// DID is the only stable identifier in our DB (profile name lives
				// on federated syr instances). Name-based search has to happen
				// client-side on the current page for now.
				search: searchSpec
			}
		);

		const enriched = await this.enrichMembers(ref, items);
		return { items: enriched, total };
	}

	private async enrichMembers(serverRef: RecordId, members: any[]) {
		if (!members.length) return [];

		const userIds = [...new Set(members.map((m) => (m as any).user_id as string))];
		const users = await this.users.findMany();
		const instanceMap = new Map<string, string>(
			users
				.filter((u) => userIds.includes((u as any).did as string))
				.map((u) => [(u as any).did as string, (u as any).syr_instance_url as string])
		);

		const server = await this.servers.findById(serverRef);
		const ownerId = (server as any)?.owner_id as string | undefined;

		const roles = await this.roles.findMany({ server_id: serverRef });
		const rolePermMap = new Map<string, bigint>(
			roles.map((r) => [stringToRecordId.encode((r as any).id), BigInt(((r as any).permissions as string) ?? '0')])
		);
		const defaultRolePerms = roles
			.filter((r) => (r as any).is_default)
			.reduce((acc, r) => acc | BigInt(((r as any).permissions as string) ?? '0'), 0n);

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
				.sort((a, b) => b.position - a.position);

			// Effective permissions: server owner always gets ADMINISTRATOR;
			// everyone else gets the OR of default-role perms + their role perms.
			const isOwner = ownerId && (m as any).user_id === ownerId;
			let perms = isOwner ? Permissions.ADMINISTRATOR : defaultRolePerms;
			if (!isOwner) {
				for (const roleId of roleIds) perms |= rolePermMap.get(roleId) ?? 0n;
			}
			const permission_count = effectivePermCount(perms);

			return {
				...m,
				syr_instance_url: instanceMap.get((m as any).user_id as string),
				roles: memberRoles,
				permissions: perms.toString(),
				permission_count
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
