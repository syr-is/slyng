import { Injectable, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { DEFAULT_PERMISSIONS, Permissions, WsOp, stringToRecordId } from '@syren/types';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository,
	ServerBanRepository
} from './server.repository';
import { ChannelRepository } from '../channel/channel.repository';
import { RoleService } from '../role/role.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { UserRepository } from '../auth/user.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Inject, Optional } from '@nestjs/common';

@Injectable()
export class ServerService {
	private readonly logger = new Logger(ServerService.name);

	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly roles: ServerRoleRepository,
		private readonly invites: ServerInviteRepository,
		private readonly bans: ServerBanRepository,
		private readonly channels: ChannelRepository,
		private readonly roleService: RoleService,
		private readonly userRepository: UserRepository,
		private readonly audit: AuditLogService,
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
			deleted: false,
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
		// Permission enforced at route layer via `@RequirePermission('MANAGE_SERVER')`.

		const merge: Record<string, unknown> = { updated_at: new Date() };
		if (data.name !== undefined) merge.name = data.name;
		if (data.description !== undefined) merge.description = data.description;
		if (data.icon_url !== undefined) merge.icon_url = data.icon_url;
		if (data.banner_url !== undefined) merge.banner_url = data.banner_url;
		if (data.invite_background_url !== undefined) merge.invite_background_url = data.invite_background_url;

		await this.servers.merge(serverId, merge);
		await this.audit.record({
			serverId,
			actorId: userId,
			action: 'server_update',
			targetKind: 'server',
			targetId: serverId,
			metadata: { changes: data }
		});
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
			target_kind: (inv.target_kind ?? 'open') as 'open' | 'instance' | 'did',
			target_value: (inv.target_value ?? null) as string | null,
			label: (inv.label ?? null) as string | null,
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
			this.invites.deleteWhere({ server_id: id }),
			this.bans.deleteWhere({ server_id: id })
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

	async createInvite(
		serverId: string,
		createdBy: string,
		data: {
			max_uses?: number;
			expires_in?: number;
			target_kind?: 'open' | 'instance' | 'did';
			target_value?: string;
			label?: string;
		} = {}
	) {
		// Permission enforced at route layer via `@RequirePermission('CREATE_INVITES')`.
		const targetKind = data.target_kind ?? 'open';
		let targetValue = data.target_value?.trim() || undefined;

		// Validate target shape
		if (targetKind === 'instance') {
			if (!targetValue) throw new Error('Instance-scoped invite needs a host');
			// Strip protocol/path if user pasted a URL
			try {
				targetValue = new URL(targetValue.startsWith('http') ? targetValue : `https://${targetValue}`).host;
			} catch {
				throw new Error('Invalid instance host');
			}
		} else if (targetKind === 'did') {
			if (!targetValue) throw new Error('DID-scoped invite needs a target');
			// Accept either `did:…` or `handle@instance.host`. Handle form is
			// resolved against the joiner's profile at redeem time.
			if (!targetValue.startsWith('did:')) {
				const at = targetValue.indexOf('@');
				if (at <= 0 || at === targetValue.length - 1) {
					throw new Error('Target must be a DID (did:…) or a handle (user@instance.host)');
				}
				// Lowercase the host half for stable comparison later
				const [handle, host] = targetValue.split('@');
				targetValue = `${handle}@${host.toLowerCase()}`;
			}
		} else {
			targetValue = undefined;
		}

		const code = this.generateInviteCode();
		const now = new Date();
		const expiresAt = data.expires_in ? new Date(now.getTime() + data.expires_in * 1000) : null;
		const serverRef = stringToRecordId.decode(serverId);

		await this.invites.create({
			server_id: serverRef,
			code,
			created_by: createdBy,
			max_uses: data.max_uses ?? 0,
			uses: 0,
			expires_at: expiresAt,
			target_kind: targetKind,
			target_value: targetValue ?? null,
			label: data.label?.trim() || null,
			created_at: now,
			updated_at: now
		});

		await this.audit.record({
			serverId,
			actorId: createdBy,
			action: 'invite_create',
			targetKind: 'invite',
			targetId: code,
			metadata: {
				target_kind: targetKind,
				target_value: targetValue ?? null,
				max_uses: data.max_uses ?? 0,
				expires_at: expiresAt?.toISOString() ?? null,
				label: data.label ?? null
			}
		});

		return { code };
	}

	async listInvites(
		serverId: string,
		actorUserId: string,
		options: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
	) {
		// Permission enforced at route layer via `@RequirePermission('CREATE_INVITES')`.
		const serverRef = stringToRecordId.decode(serverId);

		const sortField = options.sort && ['created_at', 'uses', 'expires_at', 'code'].includes(options.sort)
			? options.sort
			: 'created_at';
		const sortOrder: 'asc' | 'desc' = options.order === 'asc' ? 'asc' : 'desc';

		const { items, total } = await this.invites.findPage(
			{ server_id: serverRef },
			{
				sort: { field: sortField, order: sortOrder },
				limit: options.limit,
				offset: options.offset,
				search: options.q ? { fields: ['code', 'target_value', 'label'], query: options.q } : undefined
			}
		);

		return {
			items: items.map((i) => this.serializeInvite(i as any)),
			total
		};
	}

	async deleteInvite(serverId: string, code: string, actorUserId: string) {
		const invite = await this.invites.findOne({ code });
		if (!invite) throw new Error('Invite not found');
		const inv = invite as any;
		if (stringToRecordId.encode(inv.server_id) !== serverId) {
			throw new Error('Invite does not belong to this server');
		}
		// Invite deletion has mixed-identity semantics: the creator can always
		// revoke their own invite; everyone else needs MANAGE_INVITES. This
		// can't be expressed as a single `@RequirePermission(...)` on the
		// route, so we enforce at the service.
		const isCreator = inv.created_by === actorUserId;
		if (!isCreator) {
			const ok = await this.roleService.hasPermission(
				actorUserId,
				serverId,
				Permissions.MANAGE_INVITES
			);
			if (!ok) throw new Error('MANAGE_INVITES required to revoke this invite');
		}
		await this.invites.delete(inv.id);
		await this.audit.record({
			serverId,
			actorId: actorUserId,
			action: 'invite_delete',
			targetKind: 'invite',
			targetId: code,
			metadata: {
				target_kind: inv.target_kind ?? 'open',
				target_value: inv.target_value ?? null,
				uses: inv.uses ?? 0,
				was_creator: isCreator
			}
		});
		this.logger.log(`Invite deleted: ${code}`);
	}

	/**
	 * Fetch a user's federated handle (`<username>@<host>`) by resolving their
	 * syr instance manifest + profile. Used only for handle-form invite checks
	 * so it's OK to fail closed — returns null on any error.
	 */
	private async resolveJoinerHandle(userId: string): Promise<string | null> {
		const user = await this.userRepository.findOne({ did: userId });
		const instanceUrl = (user as any)?.syr_instance_url as string | undefined;
		if (!instanceUrl) return null;

		const base = instanceUrl.replace(/\/+$/, '');
		let host: string;
		try {
			host = new URL(instanceUrl).host.toLowerCase();
		} catch {
			return null;
		}

		try {
			const manifestRes = await fetch(`${base}/.well-known/syr/${encodeURIComponent(userId)}`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (!manifestRes.ok) return null;
			const manifest = (await manifestRes.json()) as { endpoints?: { profile?: string } };
			const profileUrl = manifest.endpoints?.profile;
			if (!profileUrl) return null;

			const profileRes = await fetch(profileUrl, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (!profileRes.ok) return null;
			const body = (await profileRes.json()) as { data?: { username?: string } };
			const username = body.data?.username;
			if (!username) return null;
			return `${username}@${host}`;
		} catch {
			return null;
		}
	}

	private serializeInvite(inv: any) {
		return {
			id: inv.id ? stringToRecordId.encode(inv.id) : undefined,
			server_id: stringToRecordId.encode(inv.server_id),
			code: inv.code as string,
			created_by: inv.created_by as string,
			created_at: inv.created_at,
			expires_at: inv.expires_at ?? null,
			max_uses: inv.max_uses ?? 0,
			uses: inv.uses ?? 0,
			target_kind: (inv.target_kind ?? 'open') as 'open' | 'instance' | 'did',
			target_value: inv.target_value ?? null,
			label: inv.label ?? null
		};
	}

	async joinByInvite(userId: string, code: string) {
		const invite = await this.invites.findOne({ code });
		if (!invite) {
			this.logger.warn(`join: invalid code=${code}`);
			throw new Error('Invalid invite code');
		}

		const inv = invite as any;
		const targetKind = (inv.target_kind ?? 'open') as 'open' | 'instance' | 'did';
		const targetValue = inv.target_value as string | undefined;
		this.logger.log(
			`join attempt: code=${code} user=${userId.slice(0, 24)} kind=${targetKind} target=${targetValue ?? 'null'} uses=${inv.uses}/${inv.max_uses}`
		);

		if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
			this.logger.log(`join blocked: invite ${code} expired at ${inv.expires_at}`);
			throw new Error('Invite has expired');
		}
		if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
			this.logger.log(`join blocked: invite ${code} max_uses reached ${inv.uses}/${inv.max_uses}`);
			throw new Error('Invite has reached maximum uses');
		}

		// Block banned users up-front — message is deliberately neutral. Only
		// ACTIVE bans count; unbanned rows are retained for audit history.
		const existingBan = await this.bans.findOne({
			server_id: inv.server_id,
			user_id: userId,
			active: true
		});
		if (existingBan) {
			this.logger.warn(
				`join blocked: user=${userId.slice(0, 24)} is banned from server=${String(inv.server_id)} (ban_id=${String((existingBan as any).id)})`
			);
			throw new Error('You cannot join this server');
		}

		// Target-scope enforcement
		if (targetKind === 'did') {
			if (!targetValue) {
				this.logger.warn(`join: DID-scoped invite ${code} has no target_value`);
				throw new Error('Invalid invite target');
			}
			if (targetValue.startsWith('did:')) {
				if (userId !== targetValue) {
					this.logger.log(
						`join blocked: DID mismatch joiner=${userId.slice(0, 24)} target=${targetValue.slice(0, 24)}`
					);
					throw new Error('This invite is for another user');
				}
				this.logger.log(`join: DID match for ${userId.slice(0, 24)}`);
			} else {
				// Handle form: <handle>@<host>. Resolve joiner's current handle
				// from their syr instance profile and match.
				const match = await this.resolveJoinerHandle(userId);
				this.logger.log(
					`join: handle-scoped check target="${targetValue}" resolved="${match ?? 'null'}"`
				);
				if (!match || match.toLowerCase() !== targetValue.toLowerCase()) {
					throw new Error('This invite is for another user');
				}
			}
		} else if (targetKind === 'instance') {
			if (!targetValue) throw new Error('Invalid invite target');
			const user = await this.userRepository.findOne({ did: userId });
			const userInstance = (user as any)?.syr_instance_url as string | undefined;
			if (!userInstance) throw new Error('Could not verify your instance');
			let userHost = '';
			try {
				userHost = new URL(userInstance).host;
			} catch {
				throw new Error('Invalid user instance');
			}
			if (userHost !== targetValue) {
				throw new Error(`This invite is restricted to users from ${targetValue}`);
			}
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
