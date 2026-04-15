import { Injectable, Inject, Optional, Logger, forwardRef } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import {
	Permissions,
	WsOp,
	stringToRecordId,
	type AuditAction,
	type AuditTargetKind
} from '@syren/types';
import { AuditLogRepository } from './audit-log.repository';
import { MessageRepository } from '../message/message.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';

/**
 * Single write-point for every auditable server action. Every mutation
 * (kick, ban, role change, message delete, channel CRUD, etc.) calls
 * `record(...)`. Failures are swallowed + logged so an audit write never
 * takes down the originating operation.
 */
@Injectable()
export class AuditLogService {
	private readonly logger = new Logger(AuditLogService.name);

	constructor(
		private readonly repo: AuditLogRepository,
		private readonly messages: MessageRepository,
		@Inject(forwardRef(() => RoleService))
		private readonly roleService: RoleService,
		@Optional() @Inject(ChatGateway) private readonly gateway?: ChatGateway
	) {}

	async record(params: {
		serverId: string;
		actorId: string;
		action: AuditAction;
		targetKind: AuditTargetKind;
		targetId: string | null;
		targetUserId?: string;
		channelId?: string;
		metadata?: Record<string, unknown>;
		reason?: string;
		batchId?: string;
	}): Promise<void> {
		try {
			const now = new Date();
			const serverRef = stringToRecordId.decode(params.serverId);
			const row = await this.repo.create({
				server_id: serverRef,
				actor_id: params.actorId,
				action: params.action,
				target_kind: params.targetKind,
				target_id: params.targetId ?? null,
				target_user_id: params.targetUserId ?? null,
				channel_id: params.channelId ?? null,
				metadata: params.metadata ?? {},
				reason: params.reason ?? null,
				batch_id: params.batchId ?? null,
				created_at: now,
				updated_at: now
			});

			// Live-update subscribers to the audit-log page / moderation sheet.
			// No content in the payload for removed-message actions — privileged
			// clients must re-fetch via HTTP to get masked details.
			this.gateway?.emitToServer(params.serverId, {
				op: WsOp.AUDIT_LOG_APPEND,
				d: this.serialize(row)
			});
		} catch (err) {
			this.logger.warn(
				`audit write failed action=${params.action} actor=${params.actorId} target=${params.targetId}: ${(err as Error).message}`
			);
		}
	}

	async listForServer(
		serverId: string,
		options: {
			limit?: number;
			offset?: number;
			action?: AuditAction;
			actor_id?: string;
			target_user_id?: string;
			channel_id?: string;
			since?: Date;
			until?: Date;
			q?: string;
		} = {},
		actorUserId?: string
	): Promise<{ items: any[]; total: number }> {
		const serverRef = stringToRecordId.decode(serverId);
		const filters: Record<string, unknown> = { server_id: serverRef };
		if (options.action) filters.action = options.action;
		if (options.actor_id) filters.actor_id = options.actor_id;
		if (options.target_user_id) filters.target_user_id = options.target_user_id;
		if (options.channel_id) filters.channel_id = options.channel_id;

		// Pagination + search via BaseRepository, then in-memory date-range filter
		// (SurrealDB range filters via BaseRepository's equality builder aren't
		// a first-class feature; the audit table is bounded per server).
		const { items, total } = await this.repo.findPage(filters, {
			sort: { field: 'created_at', order: 'desc' },
			limit: options.limit,
			offset: options.offset,
			search: options.q
				? { fields: ['reason', 'actor_id', 'target_id'], query: options.q }
				: undefined
		});

		let filtered = items as any[];
		if (options.since) {
			const sinceMs = options.since.getTime();
			filtered = filtered.filter(
				(r) => new Date((r as any).created_at as string).getTime() >= sinceMs
			);
		}
		if (options.until) {
			const untilMs = options.until.getTime();
			filtered = filtered.filter(
				(r) => new Date((r as any).created_at as string).getTime() <= untilMs
			);
		}

		const serialized = filtered.map((r) => this.serialize(r));
		const enriched = await this.attachRemovedMessageContent(serialized, serverId, actorUserId);
		return { items: enriched, total };
	}

	async listForUser(
		serverId: string,
		userId: string,
		options: { limit?: number; offset?: number; action?: AuditAction; q?: string } = {},
		actorUserId?: string
	): Promise<{ items: any[]; total: number }> {
		return this.listForServer(
			serverId,
			{ ...options, target_user_id: userId },
			actorUserId
		);
	}

	/**
	 * Inline the original content + attachments of soft-deleted messages
	 * into `message_delete` / `message_purge` / `message_hard_delete` audit
	 * rows, for callers who hold `VIEW_REMOVED_MESSAGES`. Everyone else gets
	 * the bare audit row. Hard-deleted messages have no row to look up —
	 * those entries stay contentless regardless of perm.
	 */
	private async attachRemovedMessageContent(
		items: any[],
		serverId: string,
		actorUserId?: string
	): Promise<any[]> {
		if (!actorUserId) return items;
		const hasMessageRow = items.some(
			(r) => r.action === 'message_delete' || r.action === 'message_purge'
		);
		if (!hasMessageRow) return items;
		const canReveal = await this.roleService.hasPermission(
			actorUserId,
			serverId,
			Permissions.VIEW_REMOVED_MESSAGES
		);
		if (!canReveal) return items;

		const messageIds = items
			.filter(
				(r) => (r.action === 'message_delete' || r.action === 'message_purge') && r.target_id
			)
			.map((r) => r.target_id as string);
		if (!messageIds.length) return items;

		const messages = await this.messages.findByIds(messageIds);
		const byId = new Map<string, any>();
		for (const m of messages) {
			byId.set(stringToRecordId.encode((m as any).id as RecordId), m);
		}

		return items.map((r) => {
			if (
				(r.action === 'message_delete' || r.action === 'message_purge') &&
				r.target_id &&
				byId.has(r.target_id)
			) {
				const m = byId.get(r.target_id);
				return {
					...r,
					metadata: {
						...r.metadata,
						message_content: (m as any).content ?? '',
						message_attachments: (m as any).attachments ?? [],
						message_sender_id: (m as any).sender_id ?? null
					}
				};
			}
			return r;
		});
	}

	private serialize(row: any) {
		return {
			id: row?.id ? stringToRecordId.encode(row.id as RecordId) : undefined,
			server_id: row?.server_id ? stringToRecordId.encode(row.server_id as RecordId) : null,
			actor_id: row.actor_id,
			action: row.action,
			target_kind: row.target_kind,
			target_id: row.target_id,
			target_user_id: row.target_user_id ?? null,
			channel_id: row.channel_id ?? null,
			metadata: row.metadata ?? {},
			reason: row.reason ?? null,
			batch_id: row.batch_id ?? null,
			created_at: row.created_at
		};
	}
}
