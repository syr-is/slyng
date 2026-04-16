import { Injectable, Optional, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { WsOp, stringToRecordId } from '@syren/types';
import { ChannelCategoryRepository } from '../channel/channel.repository';
import { ChannelRepository } from '../channel/channel.repository';
import { ChatGateway } from '../gateway/chat.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class CategoryService {
	private readonly logger = new Logger(CategoryService.name);

	constructor(
		private readonly categories: ChannelCategoryRepository,
		private readonly channels: ChannelRepository,
		private readonly audit: AuditLogService,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	async findByServer(serverId: string) {
		const ref = stringToRecordId.decode(serverId);
		return this.categories.findMany(
			{ server_id: ref },
			{ sort: { field: 'position', order: 'asc' } }
		);
	}

	async create(serverId: string, userId: string, name: string) {
		const ref = stringToRecordId.decode(serverId);
		const existing = await this.categories.findMany(
			{ server_id: ref },
			{ sort: { field: 'position', order: 'desc' }, limit: 1 }
		);
		const position = (((existing[0] as any)?.position as number) ?? -1) + 1;
		const now = new Date();
		const category = await this.categories.create({
			server_id: ref,
			name,
			position,
			created_at: now,
			updated_at: now
		} as any);
		const catId = stringToRecordId.encode((category as any).id as RecordId);
		this.gateway?.emitToServer(serverId, { op: WsOp.CATEGORY_CREATE, d: category });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_create',
			targetKind: 'channel',
			targetId: catId,
			metadata: { name, kind: 'category' }
		});
		this.logger.log(`Category created: ${catId} in ${serverId}`);
		return category;
	}

	async update(categoryId: string, userId: string, data: { name?: string }) {
		const cat = await this.categories.findById(categoryId);
		if (!cat) throw new Error('Category not found');
		const serverId = stringToRecordId.encode((cat as any).server_id as RecordId);
		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		await this.categories.merge(categoryId, merge);
		const updated = await this.categories.findById(categoryId);
		this.gateway?.emitToServer(serverId, { op: WsOp.CATEGORY_UPDATE, d: updated });
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_update',
			targetKind: 'channel',
			targetId: categoryId,
			metadata: { changes: data, kind: 'category' }
		});
		return updated;
	}

	async delete(categoryId: string, userId: string) {
		const cat = await this.categories.findById(categoryId);
		if (!cat) throw new Error('Category not found');
		const serverId = stringToRecordId.encode((cat as any).server_id as RecordId);
		const catRef = stringToRecordId.decode(categoryId);

		// Uncategorize all child channels
		const children = await this.channels.findMany({ category_id: catRef });
		for (const ch of children) {
			await this.channels.merge((ch as any).id, {
				category_id: null,
				updated_at: new Date()
			});
			this.gateway?.emitToServer(serverId, {
				op: WsOp.CHANNEL_UPDATE,
				d: { ...(ch as any), category_id: null }
			});
		}

		await this.categories.delete(categoryId);
		this.gateway?.emitToServer(serverId, {
			op: WsOp.CATEGORY_DELETE,
			d: { id: categoryId, server_id: serverId }
		});
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'channel_delete',
			targetKind: 'channel',
			targetId: categoryId,
			metadata: { name: (cat as any).name, kind: 'category' }
		});
		this.logger.log(`Category deleted: ${categoryId}`);
	}

	async swap(categoryAId: string, categoryBId: string, userId: string) {
		const a = await this.categories.findById(categoryAId);
		const b = await this.categories.findById(categoryBId);
		if (!a || !b) throw new Error('Category not found');
		const serverId = stringToRecordId.encode((a as any).server_id as RecordId);
		const posA = (a as any).position as number;
		const posB = (b as any).position as number;
		const now = new Date();
		await this.categories.merge(categoryAId, { position: posB, updated_at: now });
		await this.categories.merge(categoryBId, { position: posA, updated_at: now });
		const updA = await this.categories.findById(categoryAId);
		const updB = await this.categories.findById(categoryBId);
		this.gateway?.emitToServer(serverId, { op: WsOp.CATEGORY_UPDATE, d: updA });
		this.gateway?.emitToServer(serverId, { op: WsOp.CATEGORY_UPDATE, d: updB });
	}
}
