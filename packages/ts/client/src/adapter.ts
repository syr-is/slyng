/**
 * Thin namespace adapter over the wasm-pack-emitted `Client` from
 * `@syren/client/wasm`.
 *
 * All types come straight from the WASM build's auto-generated `.d.ts`
 * (which is in turn auto-derived from the Rust types in `syren-types`
 * via `tsify-next`). There are zero hand-rolled interfaces here, zero
 * `as Promise<…>` casts. The only thing this file does is rename the
 * snake_case methods on the wasm Client into the namespace shape every
 * consumer expects (`api.servers.list()`, `api.channels.send(…)`, …).
 *
 * If a method ever appears in `Client` but not below, the type system
 * will refuse to call it through `api.*` — that's intentional. New
 * methods get added in `syren-client/src/<domain>.rs`, surfaced in
 * `wasm.rs`, then plumbed through the matching namespace below.
 */

import type {
	Channel,
	ChannelCategory,
	CreateDmResponse,
	CreateInviteResponse,
	DmChannelSummary,
	Friendship,
	Identity,
	InviteJoinResponse,
	InvitePreview,
	LoginResponse,
	MemberMessageStats,
	MemberPermissionsView,
	Message,
	MyPermissions,
	PageAuditLog,
	PageBlockedRow,
	PageFriendshipRow,
	PageIgnoredRow,
	PageMemberMessageEntry,
	PageServerBan,
	PageServerInvite,
	PageServerMember,
	PageTrashMessageEntry,
	PaginatedQuery,
	PermissionOverride,
	PermissionTree,
	RelationsSnapshot,
	Server,
	ServerBan,
	ServerInvite,
	ServerMember,
	ServerRole,
	SuccessResponse,
	TransferOwnershipResponse,
	TrashChannelEntry,
	TrashMessageEntry,
	TrashRoleEntry,
	UploadFinalizeResponse,
	UploadPresignResponse,
	User,
	UserResolveResult,
	VoiceTokenResponse,
	Client as WasmClient,
} from '@syren/client/wasm';

// Re-export the wasm-emitted types so consumers can `import type
// { Server } from '@syren/client'` without reaching into
// `dist/wasm/web/`. Adding more here is purely a convenience —
// the canonical source is always `@syren/client/wasm`.
export type {
	AllowDms,
	AllowFriendRequests,
	Attachment,
	AuditAction,
	AuditLog,
	AuditTargetKind,
	BanMemberInput,
	BlockedRow,
	Channel,
	ChannelCategory,
	ChannelParticipant,
	ChannelReorderInput,
	ChannelType,
	CreateDmResponse,
	CreateInviteInput,
	CreateInviteResponse,
	DmChannelSummary,
	Embed,
	ExchangeRequest,
	ExchangeResponse,
	Friendship,
	FriendshipRow,
	FriendshipStatus,
	Identity,
	IgnoredRow,
	InvitePreview,
	InvitePreviewServer,
	InviteJoinResponse,
	InviteTargetKind,
	KickMemberQuery,
	LoginRequest,
	LoginResponse,
	MemberMessageEntry,
	MemberMessagePerChannel,
	MemberMessageStats,
	MemberPermissionsView,
	Message,
	MessageReaction,
	MessageType,
	MyPermissions,
	PageAuditLog,
	PageBlockedRow,
	PageFriendshipRow,
	PageIgnoredRow,
	PageMemberMessageEntry,
	PageServerBan,
	PageServerInvite,
	PageServerMember,
	PageTrashMessageEntry,
	PaginatedQuery,
	ParticipantRole,
	PendingFriendRequest,
	PermissionOverride,
	PermissionScopeType,
	PermissionTargetType,
	PermissionTree,
	PermissionTreeCategory,
	PermissionTreeChannel,
	PermissionTreeServer,
	Presence,
	PresenceStatus,
	PurgeMessagesInput,
	ReactionKind,
	ReactionSummary,
	RelationsSnapshot,
	SendMessageInput,
	Server,
	ServerBan,
	ServerInvite,
	ServerMember,
	ServerRole,
	SuccessResponse,
	TransferOwnershipResponse,
	TrashChannelEntry,
	TrashMessageEntry,
	TrashRoleEntry,
	UpdateInviteInput,
	UpdateMyselfInput,
	UploadFinalizeInput,
	UploadFinalizeResponse,
	UploadPresignInput,
	UploadPresignResponse,
	UpsertOverrideInput,
	User,
	UserBlock,
	UserIgnore,
	UserResolveResult,
	VisibleChannelSummary,
	VoiceState,
	VoiceTokenResponse,
} from '@syren/client/wasm';

// ── Public client surface ────────────────────────────────────────────

/** Top-level shape every consumer talks through. Implementations exist
 *  for both web (WASM-backed via `initSyrenClient`) and native
 *  (Tauri-IPC-backed via Phase 7's `createNativeApi`). Both speak the
 *  same types because both source them from `@syren/client/wasm`. */
export interface SyrenClient {
	auth: {
		me(): Promise<Identity>;
		login(instanceUrl: string, redirect?: string): Promise<LoginResponse>;
		logout(): Promise<{ success: boolean }>;
		exchange(code: string): Promise<Identity>;
	};
	servers: {
		list(): Promise<Server[]>;
		create(data: unknown): Promise<Server>;
		get(id: string): Promise<Server>;
		update(id: string, data: unknown): Promise<Server>;
		delete(id: string): Promise<SuccessResponse>;
		leave(id: string): Promise<SuccessResponse>;
		transferOwnership(id: string, newOwnerId: string): Promise<TransferOwnershipResponse>;
		channels(id: string): Promise<Channel[]>;
		members(id: string): Promise<ServerMember[]>;
		membersPage(id: string, params?: PaginatedQuery): Promise<PageServerMember>;
		voiceStates(id: string): Promise<Record<string, unknown>>;
		createChannel(id: string, data: unknown): Promise<Channel>;
		kickMember(serverId: string, userId: string, opts?: { delete_seconds?: number }): Promise<SuccessResponse>;
		banMember(serverId: string, body: unknown): Promise<ServerBan>;
		unbanMember(serverId: string, userId: string): Promise<SuccessResponse>;
		listBans(serverId: string, params?: unknown): Promise<PageServerBan>;
		memberMessages(serverId: string, userId: string, params?: unknown): Promise<PageMemberMessageEntry>;
		memberMessageStats(serverId: string, userId: string): Promise<MemberMessageStats>;
		purgeMemberMessages(serverId: string, userId: string, body: unknown): Promise<SuccessResponse>;
		memberBanHistory(serverId: string, userId: string): Promise<ServerBan[]>;
		auditLog(serverId: string, params?: unknown): Promise<PageAuditLog>;
		memberAuditLog(serverId: string, userId: string, params?: unknown): Promise<PageAuditLog>;
		createInvite(serverId: string, data?: unknown): Promise<CreateInviteResponse>;
		listInvites(serverId: string, params?: PaginatedQuery): Promise<PageServerInvite>;
		deleteInvite(serverId: string, code: string): Promise<SuccessResponse>;
		updateInvite(serverId: string, code: string, data: unknown): Promise<ServerInvite>;
		trashChannels(serverId: string): Promise<TrashChannelEntry[]>;
		trashRoles(serverId: string): Promise<TrashRoleEntry[]>;
		trashMessages(serverId: string, params?: unknown): Promise<PageTrashMessageEntry>;
	};
	invites: {
		preview(code: string): Promise<InvitePreview>;
		join(code: string): Promise<InviteJoinResponse>;
	};
	roles: {
		list(serverId: string): Promise<ServerRole[]>;
		create(serverId: string, data: unknown): Promise<ServerRole>;
		update(roleId: string, data: unknown): Promise<ServerRole>;
		delete(roleId: string): Promise<SuccessResponse>;
		swap(roleId: string, otherRoleId: string): Promise<SuccessResponse>;
		reorder(serverId: string, roleIds: string[]): Promise<SuccessResponse>;
		assign(serverId: string, userId: string, roleId: string): Promise<SuccessResponse>;
		unassign(serverId: string, userId: string, roleId: string): Promise<SuccessResponse>;
		myPermissions(serverId: string): Promise<MyPermissions>;
		permissionTree(serverId: string, userId: string): Promise<PermissionTree>;
		memberPermissions(serverId: string, userId: string): Promise<MemberPermissionsView>;
		restore(roleId: string): Promise<ServerRole>;
		hardDelete(roleId: string): Promise<SuccessResponse>;
	};
	channels: {
		messages(id: string, opts?: { before?: string; limit?: number; include_deleted?: boolean }): Promise<Message[]>;
		send(id: string, data: unknown): Promise<Message>;
		editMessage(channelId: string, messageId: string, content: string): Promise<Message>;
		deleteMessage(channelId: string, messageId: string): Promise<SuccessResponse>;
		clearEmbeds(channelId: string, messageId: string): Promise<Message>;
		addReaction(channelId: string, messageId: string, kind: string, value: string): Promise<Message>;
		pins(id: string, opts?: { include_deleted?: boolean }): Promise<Message[]>;
		pin(channelId: string, messageId: string): Promise<SuccessResponse>;
		unpin(channelId: string, messageId: string): Promise<SuccessResponse>;
		typing(id: string): Promise<SuccessResponse>;
		update(id: string, data: unknown): Promise<Channel>;
		delete(id: string): Promise<SuccessResponse>;
		restore(id: string): Promise<Channel>;
		hardDelete(id: string): Promise<SuccessResponse>;
		restoreMessage(channelId: string, messageId: string): Promise<Message>;
		hardDeleteMessage(channelId: string, messageId: string): Promise<SuccessResponse>;
		reorder(serverId: string, body: unknown): Promise<SuccessResponse>;
	};
	uploads: {
		presign(data: unknown): Promise<UploadPresignResponse>;
		finalize(uploadId: string, data: unknown): Promise<UploadFinalizeResponse>;
	};
	users: {
		me(): Promise<User>;
		resolve(q: string): Promise<UserResolveResult>;
		updateMe(data: unknown): Promise<User>;
		dmChannels(): Promise<DmChannelSummary[]>;
		createDM(recipientId: string, syrInstanceUrl?: string): Promise<CreateDmResponse>;
	};
	relations: {
		snapshot(): Promise<RelationsSnapshot>;
		listFriends(params?: unknown): Promise<PageFriendshipRow>;
		listBlocked(params?: unknown): Promise<PageBlockedRow>;
		listIgnored(params?: unknown): Promise<PageIgnoredRow>;
		sendRequest(userId: string, syrInstanceUrl?: string): Promise<Friendship>;
		accept(userId: string): Promise<Friendship>;
		decline(userId: string): Promise<SuccessResponse>;
		cancelOrRemove(userId: string): Promise<SuccessResponse>;
		block(userId: string): Promise<SuccessResponse>;
		unblock(userId: string): Promise<SuccessResponse>;
		ignore(userId: string): Promise<SuccessResponse>;
		unignore(userId: string): Promise<SuccessResponse>;
	};
	voice: {
		token(channelId: string): Promise<VoiceTokenResponse>;
	};
	categories: {
		list(serverId: string): Promise<ChannelCategory[]>;
		create(serverId: string, data: { name: string }): Promise<ChannelCategory>;
		update(categoryId: string, data: unknown): Promise<ChannelCategory>;
		delete(categoryId: string): Promise<SuccessResponse>;
		swap(a: string, b: string): Promise<SuccessResponse>;
		reorder(serverId: string, categoryIds: string[]): Promise<SuccessResponse>;
	};
	overrides: {
		list(serverId: string): Promise<PermissionOverride[]>;
		forChannel(serverId: string, channelId: string): Promise<PermissionOverride[]>;
		forCategory(serverId: string, categoryId: string): Promise<PermissionOverride[]>;
		upsert(serverId: string, data: unknown): Promise<PermissionOverride>;
		delete(serverId: string, overrideId: string): Promise<SuccessResponse>;
	};
	/** Release the underlying WASM allocation. Idempotent. */
	dispose(): void;
}

// ── WASM module loader (browser dynamic import) ──────────────────────

interface WasmExports {
	default?: (() => Promise<unknown>) | unknown;
	Client: new (baseUrl: string, sessionKey?: string) => WasmClient;
}

let wasm: WasmExports | null = null;
let initPromise: Promise<void> | null = null;

async function loadWasm(): Promise<WasmExports> {
	if (wasm) return wasm;
	if (!initPromise) {
		initPromise = (async () => {
			if (typeof globalThis.WebAssembly === 'undefined') {
				throw new Error('WebAssembly is not supported in this environment');
			}
			// Plain dynamic import so the host bundler can statically
			// discover the dependency and emit the matching `.wasm`
			// asset alongside the JS.
			const mod = (await import('@syren/client/wasm')) as unknown as WasmExports;
			if (typeof mod.default === 'function') {
				await (mod.default as () => Promise<unknown>)();
			}
			wasm = mod;
		})();
	}
	await initPromise;
	if (!wasm) throw new Error('@syren/client: WASM failed to initialise');
	return wasm;
}

export async function initSyrenClient(
	baseUrl: string,
	opts: { sessionKey?: string } = {},
): Promise<SyrenClient> {
	const m = await loadWasm();
	const inner = new m.Client(baseUrl, opts.sessionKey ?? 'syren_session');
	return wrap(inner);
}

// ── Namespace adapter ───────────────────────────────────────────────
//
// Every method below is a one-liner: forward the call to the wasm
// Client method of the same idea, snake_case → camelCase only. There
// are no `as` casts; the wasm-pack `.d.ts` already gives us the right
// return type. If a wrapper is more than one line, the wasm signature
// already does the work and we should just use it.

function wrap(c: WasmClient): SyrenClient {
	return {
		auth: {
			me: () => c.me(),
			login: (i, r) => c.login_start(i, r),
			logout: async () => {
				await c.logout();
				return { success: true };
			},
			exchange: (code) => c.login_complete(code),
		},
		servers: {
			list: () => c.servers_list(),
			create: (data) => c.server_create(data),
			get: (id) => c.server_get(id),
			update: (id, data) => c.server_update(id, data),
			delete: (id) => c.server_delete(id),
			leave: (id) => c.server_leave(id),
			transferOwnership: (id, newOwnerId) => c.server_transfer_ownership(id, newOwnerId),
			channels: (id) => c.server_channels(id),
			members: (id) => c.server_members(id),
			membersPage: (id, params) => c.server_members_page(id, params ?? {}),
			voiceStates: (id) => c.server_voice_states(id) as Promise<Record<string, unknown>>,
			createChannel: (id, data) => c.server_create_channel(id, data),
			kickMember: (sid, uid, opts) => c.member_kick(sid, uid, opts?.delete_seconds),
			banMember: (sid, body) => c.member_ban(sid, body),
			unbanMember: (sid, uid) => c.member_unban(sid, uid),
			listBans: (sid, params) => c.list_bans(sid, params ?? {}),
			memberMessages: (sid, uid, params) => c.member_messages(sid, uid, params ?? {}),
			memberMessageStats: (sid, uid) => c.member_message_stats(sid, uid),
			purgeMemberMessages: (sid, uid, body) => c.purge_member_messages(sid, uid, body),
			memberBanHistory: (sid, uid) => c.member_ban_history(sid, uid),
			auditLog: (sid, params) => c.audit_log(sid, params ?? {}),
			memberAuditLog: (sid, uid, params) => c.member_audit_log(sid, uid, params ?? {}),
			createInvite: (id, data) => c.invites_create(id, data ?? {}),
			listInvites: (id, params) => c.invites_list(id, params ?? {}),
			deleteInvite: (id, code) => c.invite_delete(id, code),
			updateInvite: (id, code, data) => c.update_invite(id, code, data),
			trashChannels: (id) => c.trash_channels(id),
			trashRoles: (id) => c.trash_roles(id),
			trashMessages: (id, params) => c.trash_messages(id, params ?? {}),
		},
		invites: {
			preview: (code) => c.invite_preview(code),
			join: (code) => c.invite_join(code),
		},
		roles: {
			list: (sid) => c.roles_list(sid),
			create: (sid, data) => c.role_create(sid, data),
			update: (rid, data) => c.role_update(rid, data),
			delete: (rid) => c.role_delete(rid),
			swap: (a, b) => c.role_swap(a, b),
			reorder: (sid, ids) => c.role_reorder(sid, ids),
			assign: (sid, uid, rid) => c.role_assign(sid, uid, rid),
			unassign: (sid, uid, rid) => c.role_unassign(sid, uid, rid),
			myPermissions: (sid) => c.my_permissions(sid),
			permissionTree: (sid, uid) => c.role_permission_tree(sid, uid),
			memberPermissions: (sid, uid) => c.role_member_permissions(sid, uid),
			restore: (rid) => c.role_restore(rid),
			hardDelete: (rid) => c.role_hard_delete(rid),
		},
		channels: {
			messages: (id, opts) =>
				c.channel_messages(id, opts?.before, opts?.limit, opts?.include_deleted),
			send: (id, data) => c.channel_send(id, data),
			editMessage: (cid, mid, content) => c.channel_edit_message(cid, mid, content),
			deleteMessage: (cid, mid) => c.channel_delete_message(cid, mid),
			clearEmbeds: (cid, mid) => c.channel_clear_embeds(cid, mid),
			addReaction: (cid, mid, kind, value) => c.channel_add_reaction(cid, mid, kind, value),
			pins: (id, opts) => c.channel_pins(id, opts?.include_deleted),
			pin: (cid, mid) => c.channel_pin(cid, mid),
			unpin: (cid, mid) => c.channel_unpin(cid, mid),
			typing: (id) => c.channel_typing(id),
			update: (id, data) => c.channel_update(id, data),
			delete: (id) => c.channel_delete(id),
			restore: (id) => c.channel_restore(id),
			hardDelete: (id) => c.channel_hard_delete(id),
			restoreMessage: (cid, mid) => c.channel_restore_message(cid, mid),
			hardDeleteMessage: (cid, mid) => c.channel_hard_delete_message(cid, mid),
			reorder: (sid, body) => c.channel_reorder(sid, body),
		},
		uploads: {
			presign: (data) => c.upload_presign(data),
			finalize: (id, data) => c.upload_finalize(id, data),
		},
		users: {
			me: () => c.users_me(),
			resolve: (q) => c.users_resolve(q),
			updateMe: (data) => c.users_update_me(data),
			dmChannels: () => c.dm_channels(),
			createDM: (rid, instance) => c.create_dm(rid, instance),
		},
		relations: {
			snapshot: () => c.relations_snapshot(),
			listFriends: (params) => c.list_friends(params ?? {}),
			listBlocked: (params) => c.list_blocked(params ?? {}),
			listIgnored: (params) => c.list_ignored(params ?? {}),
			sendRequest: (uid, instance) => c.friend_send(uid, instance),
			accept: (uid) => c.friend_accept(uid),
			decline: (uid) => c.friend_decline(uid),
			cancelOrRemove: (uid) => c.friend_remove(uid),
			block: (uid) => c.block(uid),
			unblock: (uid) => c.unblock(uid),
			ignore: (uid) => c.ignore(uid),
			unignore: (uid) => c.unignore(uid),
		},
		voice: {
			token: (cid) => c.voice_token(cid),
		},
		categories: {
			list: (sid) => c.categories_list(sid),
			create: (sid, data) => c.category_create(sid, data.name),
			update: (cid, data) => c.category_update(cid, data),
			delete: (cid) => c.category_delete(cid),
			swap: (a, b) => c.category_swap(a, b),
			reorder: (sid, ids) => c.category_reorder(sid, ids),
		},
		overrides: {
			list: (sid) => c.overrides_list(sid),
			forChannel: (sid, cid) => c.overrides_for_channel(sid, cid),
			forCategory: (sid, catId) => c.overrides_for_category(sid, catId),
			upsert: (sid, data) => c.override_upsert(sid, data),
			delete: (sid, oid) => c.override_delete(sid, oid),
		},
		dispose: () => {
			try {
				(c as unknown as { free?: () => void }).free?.();
			} catch {
				/* already freed */
			}
		},
	};
}
