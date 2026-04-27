/**
 * Lazy-init wrapper that loads the WASM bundle exactly once and
 * re-exposes every method on the Rust `Client` as a typed async
 * function organised in nested namespaces (`api.servers.list()`,
 * `api.channels.send(...)`, …).
 *
 * Types come from `@syren/types`'s Zod schemas — same shapes the API
 * server uses on the wire, so the type that the adapter promises is
 * guaranteed to match what the Rust transport returns. We don't run
 * the Zod parsers on the hot path (parsing the inbound JSON twice
 * would be wasteful — the API has already validated outbound), but
 * the inferred TS types cross the boundary so consumers get full
 * autocomplete / `Server[]` instead of `unknown[]`.
 */

import type {
	Server,
	ServerMember,
	ServerInvite,
	ServerBan,
	ServerRole,
	Channel,
	ChannelCategory,
	Message,
	Attachment,
	AuditLog,
	Friendship,
	PermissionOverride,
	Presence,
	User,
	AllowDms,
	AllowFriendRequests
} from '@syren/types';

// ── Surface-specific shapes that don't have a Zod schema yet ────────

export interface Identity {
	did: string;
	syr_instance_url: string;
	delegate_public_key?: string;
	trusted_domains?: string[];
	allow_dms?: AllowDms;
	allow_friend_requests?: AllowFriendRequests;
}

export interface LoginResponse {
	consent_url: string;
}

export interface PaginatedQuery {
	limit?: number;
	offset?: number;
	sort?: string;
	order?: 'asc' | 'desc';
	q?: string;
}

export interface Page<T = unknown> {
	items: T[];
	total: number;
}

/** Shape api.ts used to inline. Per-server snapshot of voice-channel occupancy. */
export type VoiceStatesByChannel = Record<
	string,
	Array<{
		user_id: string;
		channel_id: string;
		server_id: string;
		self_mute: boolean;
		self_deaf: boolean;
		has_camera?: boolean;
		has_screen?: boolean;
	}>
>;

/** Per-channel message-stats summary for a member. */
export interface MemberMessageStats {
	total: number;
	first_at: string | null;
	last_at: string | null;
	per_channel: Array<{ channel_id: string; channel_name: string | null; count: number }>;
}

/** Aggregated view: roles + every member's permission bits + visible channels. */
export interface PermissionTree {
	server: { permissions: string };
	categories: Array<{
		id: string;
		name: string;
		position: number;
		permissions: string;
		channels: Array<{
			id: string;
			name: string;
			type: string;
			position: number;
			permissions: string;
			can_view: boolean;
		}>;
	}>;
	uncategorized: Array<{
		id: string;
		name: string;
		type: string;
		position: number;
		permissions: string;
		can_view: boolean;
	}>;
}

export interface MemberPermissionsView {
	permissions: string;
	permissions_allow: string;
	permissions_deny: string;
	highest_role_position: number;
	is_owner: boolean;
	visible_channels: Array<{ id: string; name: string; type: string }>;
}

export interface MyPermissions {
	permissions: string;
	permissions_allow: string;
	permissions_deny: string;
	highest_role_position: number;
	is_owner: boolean;
}

export interface InvitePreview {
	code: string;
	target_kind: 'open' | 'instance' | 'did';
	target_value: string | null;
	label: string | null;
	server: {
		id: string;
		name: string;
		icon_url: string | null;
		banner_url: string | null;
		invite_background_url: string | null;
		description: string | null;
		member_count: number;
	};
}

export interface UserResolveResult {
	did: string;
	syr_instance_url: string | null;
	registered: boolean;
}

export interface CreateServerInput {
	name: string;
	icon_url?: string;
	banner_url?: string;
	invite_background_url?: string;
	description?: string;
}

export interface UpdateServerInput {
	name?: string;
	description?: string;
	icon_url?: string | null;
	banner_url?: string | null;
	invite_background_url?: string | null;
}

export interface CreateChannelInput {
	name: string;
	type?: string;
	category_id?: string;
}

export interface UpdateChannelInput {
	name?: string;
	topic?: string;
	category_id?: string | null;
}

export interface SendMessageInput {
	content: string;
	reply_to?: string[];
	attachments?: Attachment[];
}

export interface CreateInviteInput {
	max_uses?: number;
	expires_in?: number;
	target_kind?: 'open' | 'instance' | 'did';
	target_value?: string;
	label?: string;
}

export interface UpdateInviteInput {
	label?: string | null;
}

export interface CreateRoleInput {
	name: string;
	color?: string | null;
	permissions?: string;
	permissions_allow?: string;
	permissions_deny?: string;
}

export interface UpdateRoleInput {
	name?: string;
	color?: string | null;
	permissions?: string;
	permissions_allow?: string;
	permissions_deny?: string;
	position?: number;
}

export interface BanMemberInput {
	user_id: string;
	reason?: string;
	delete_seconds?: number;
}

export interface KickMemberQuery {
	delete_seconds?: number;
}

export interface PurgeMessagesInput {
	delete_seconds: number;
}

export interface UploadPresignInput {
	filename: string;
	mime_type: string;
	size: number;
	channel_id?: string;
	sha256?: string;
}

export interface UploadPresignResponse {
	upload_id: string;
	signed_url: string;
	final_url: string;
	max_bytes: number;
}

export interface UploadFinalizeInput {
	sha256?: string;
	width?: number;
	height?: number;
}

export interface UploadFinalizeResponse {
	url: string;
	filename: string;
	mime_type: string;
	size: number;
	width?: number;
	height?: number;
}

export interface VoiceTokenResponse {
	token: string;
	url: string;
}

export interface UpdateMyselfInput {
	allow_dms?: AllowDms;
	allow_friend_requests?: AllowFriendRequests;
	[k: string]: unknown;
}

export interface RelationsSnapshot {
	friends: string[];
	incoming: Array<{ from: string; created_at: string }>;
	outgoing: Array<{ to: string; created_at: string }>;
	blocked: string[];
	ignored: string[];
	allow_dms: AllowDms;
	allow_friend_requests: AllowFriendRequests;
	instances: Record<string, string>;
}

export interface DmChannelSummary {
	id: string;
	type: string;
	last_message_at?: string;
	other_user_id: string | null;
	other_user_instance_url?: string | null;
	is_blocked: boolean;
	is_ignored: boolean;
}

export interface UpsertOverrideInput {
	scope_type: 'server' | 'category' | 'channel';
	scope_id: string | null;
	target_type: 'role' | 'user';
	target_id: string;
	allow: string;
	deny: string;
}

export interface ChannelReorderInput {
	channelIds: string[];
	categoryId?: string | null;
}

export interface TrashChannelEntry {
	id: string;
	name: string;
	type: string;
	deleted_at: string;
	deleted_by: string;
	message_count: number;
}

export interface TrashRoleEntry {
	id: string;
	name: string;
	color: string | null;
	deleted_at: string;
	deleted_by: string;
	member_count: number;
}

export interface TrashMessageEntry {
	id: string;
	channel_id: string;
	channel_name: string | null;
	sender_id: string;
	sender_instance_url?: string;
	content: string;
	attachments?: Attachment[];
	created_at: string;
	deleted_at: string;
	deleted_by: string;
}

export interface MemberMessageEntry {
	id: string;
	channel_id: string;
	channel_name: string | null;
	sender_id: string;
	content: string;
	created_at: string;
	edited_at?: string;
	attachments?: Attachment[];
}

// ── Raw WASM surface (snake_case mirror of the Rust impl) ──────────
//
// Every method on the Rust `Client` (in packages/rust/syren-client/src/
// {auth,servers,channels,roles,users,relations,categories,invites,
// uploads,voice,overrides}.rs) is exposed by `wasm.rs` and bound here.
// Returns are the raw JSON we trust (server-side schemas validated
// before serialisation); the typed `wrap()` below assigns them concrete
// shapes for consumers.
type J = unknown;
interface WasmClient {
	// `free` is auto-generated by wasm-bindgen on every exported struct;
	// calling it releases the underlying Rust allocation (reqwest pool,
	// session store reference) before GC would.
	free?: () => void;
	login_start(instance_url: string, redirect?: string): Promise<LoginResponse>;
	login_complete(code: string): Promise<Identity>;
	me(): Promise<Identity>;
	logout(): Promise<void>;

	servers_list(): Promise<J>;
	server_get(id: string): Promise<J>;
	server_create(data: J): Promise<J>;
	server_update(id: string, data: J): Promise<J>;
	server_delete(id: string): Promise<J>;
	server_leave(id: string): Promise<J>;
	server_transfer_ownership(server_id: string, new_owner_id: string): Promise<J>;
	server_channels(id: string): Promise<J>;
	server_members(id: string): Promise<J>;
	server_members_page(id: string, params: PaginatedQuery): Promise<J>;
	server_voice_states(id: string): Promise<J>;
	server_create_channel(server_id: string, data: J): Promise<J>;
	member_kick(server_id: string, user_id: string, delete_seconds?: number): Promise<J>;
	member_ban(server_id: string, body: J): Promise<J>;
	member_unban(server_id: string, user_id: string): Promise<J>;
	list_bans(server_id: string, params: J): Promise<J>;
	member_messages(server_id: string, user_id: string, params: J): Promise<J>;
	member_message_stats(server_id: string, user_id: string): Promise<J>;
	purge_member_messages(server_id: string, user_id: string, body: J): Promise<J>;
	member_ban_history(server_id: string, user_id: string): Promise<J>;
	audit_log(server_id: string, params: J): Promise<J>;
	member_audit_log(server_id: string, user_id: string, params: J): Promise<J>;

	invite_preview(code: string): Promise<J>;
	invite_join(code: string): Promise<J>;
	invites_create(server_id: string, data: J): Promise<J>;
	invites_list(server_id: string, params: PaginatedQuery): Promise<J>;
	invite_delete(server_id: string, code: string): Promise<J>;
	update_invite(server_id: string, code: string, data: J): Promise<J>;

	trash_channels(server_id: string): Promise<J>;
	trash_roles(server_id: string): Promise<J>;
	trash_messages(server_id: string, params: J): Promise<J>;

	channel_messages(id: string, before?: string, limit?: number, include_deleted?: boolean): Promise<J>;
	channel_send(id: string, body: J): Promise<J>;
	channel_edit_message(channel_id: string, message_id: string, content: string): Promise<J>;
	channel_delete_message(channel_id: string, message_id: string): Promise<J>;
	channel_clear_embeds(channel_id: string, message_id: string): Promise<J>;
	channel_add_reaction(channel_id: string, message_id: string, kind: string, value: string): Promise<J>;
	channel_pins(id: string, include_deleted?: boolean): Promise<J>;
	channel_pin(channel_id: string, message_id: string): Promise<J>;
	channel_unpin(channel_id: string, message_id: string): Promise<J>;
	channel_typing(id: string): Promise<J>;
	channel_update(id: string, data: J): Promise<J>;
	channel_delete(id: string): Promise<J>;
	channel_restore(id: string): Promise<J>;
	channel_hard_delete(id: string): Promise<J>;
	channel_restore_message(channel_id: string, message_id: string): Promise<J>;
	channel_hard_delete_message(channel_id: string, message_id: string): Promise<J>;
	channel_reorder(server_id: string, body: J): Promise<J>;

	roles_list(server_id: string): Promise<J>;
	role_create(server_id: string, data: J): Promise<J>;
	role_update(role_id: string, data: J): Promise<J>;
	role_delete(role_id: string): Promise<J>;
	role_swap(role_id: string, other_role_id: string): Promise<J>;
	role_assign(server_id: string, user_id: string, role_id: string): Promise<J>;
	role_unassign(server_id: string, user_id: string, role_id: string): Promise<J>;
	role_reorder(server_id: string, role_ids: string[]): Promise<J>;
	my_permissions(server_id: string): Promise<J>;
	role_permission_tree(server_id: string, user_id: string): Promise<J>;
	role_member_permissions(server_id: string, user_id: string): Promise<J>;
	role_restore(role_id: string): Promise<J>;
	role_hard_delete(role_id: string): Promise<J>;

	categories_list(server_id: string): Promise<J>;
	category_create(server_id: string, name: string): Promise<J>;
	category_update(category_id: string, data: J): Promise<J>;
	category_delete(category_id: string): Promise<J>;
	category_swap(a: string, b: string): Promise<J>;
	category_reorder(server_id: string, ids: string[]): Promise<J>;

	users_me(): Promise<J>;
	users_resolve(q: string): Promise<J>;
	users_update_me(data: J): Promise<J>;
	dm_channels(): Promise<J>;
	create_dm(recipient_id: string, syr_instance_url?: string): Promise<J>;

	relations_snapshot(): Promise<J>;
	list_friends(params: J): Promise<J>;
	list_blocked(params: J): Promise<J>;
	list_ignored(params: J): Promise<J>;
	friend_send(user_id: string, syr_instance_url?: string): Promise<J>;
	friend_accept(user_id: string): Promise<J>;
	friend_decline(user_id: string): Promise<J>;
	friend_remove(user_id: string): Promise<J>;
	block(user_id: string): Promise<J>;
	unblock(user_id: string): Promise<J>;
	ignore(user_id: string): Promise<J>;
	unignore(user_id: string): Promise<J>;

	voice_token(channel_id: string): Promise<J>;

	upload_presign(body: J): Promise<J>;
	upload_finalize(upload_id: string, body: J): Promise<J>;

	overrides_list(server_id: string): Promise<J>;
	overrides_for_channel(server_id: string, channel_id: string): Promise<J>;
	overrides_for_category(server_id: string, category_id: string): Promise<J>;
	override_upsert(server_id: string, body: J): Promise<J>;
	override_delete(server_id: string, override_id: string): Promise<J>;
}

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
			// asset alongside the JS — this is the difference between
			// "works in dev / Node" and "works in a Vite build".
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
	opts: { sessionKey?: string } = {}
): Promise<SyrenClient> {
	const m = await loadWasm();
	const inner = new m.Client(baseUrl, opts.sessionKey ?? 'syren_session');
	return wrap(inner);
}

// ─────────────────────────────────────────────────────────────────
// Public typed surface — every method's return type comes from
// @syren/types' Zod schemas where one exists, or an inline interface
// above where the shape is endpoint-specific.
// ─────────────────────────────────────────────────────────────────

export interface SyrenClient {
	auth: {
		me(): Promise<Identity>;
		login(instanceUrl: string, redirect?: string): Promise<LoginResponse>;
		logout(): Promise<{ success: boolean }>;
		exchange(code: string): Promise<Identity>;
	};
	servers: {
		list(): Promise<Server[]>;
		create(data: CreateServerInput): Promise<Server>;
		get(id: string): Promise<Server>;
		update(id: string, data: UpdateServerInput): Promise<Server>;
		delete(id: string): Promise<{ success: boolean }>;
		leave(id: string): Promise<{ success: boolean }>;
		transferOwnership(id: string, newOwnerId: string): Promise<{ server: Server; former_owner_role_id: string }>;
		channels(id: string): Promise<Channel[]>;
		members(id: string): Promise<ServerMember[]>;
		membersPage(id: string, params?: PaginatedQuery): Promise<Page<ServerMember>>;
		voiceStates(id: string): Promise<VoiceStatesByChannel>;
		createChannel(id: string, data: CreateChannelInput): Promise<Channel>;
		kickMember(serverId: string, userId: string, opts?: KickMemberQuery): Promise<{ success: boolean }>;
		banMember(serverId: string, body: BanMemberInput): Promise<ServerBan>;
		unbanMember(serverId: string, userId: string): Promise<{ success: boolean }>;
		listBans(serverId: string, params?: PaginatedQuery): Promise<Page<ServerBan>>;
		memberMessages(
			serverId: string,
			userId: string,
			params?: PaginatedQuery & { before?: string }
		): Promise<Page<MemberMessageEntry>>;
		memberMessageStats(serverId: string, userId: string): Promise<MemberMessageStats>;
		purgeMemberMessages(serverId: string, userId: string, body: PurgeMessagesInput): Promise<{ success: boolean }>;
		memberBanHistory(serverId: string, userId: string): Promise<ServerBan[]>;
		auditLog(serverId: string, params?: PaginatedQuery & Record<string, unknown>): Promise<Page<AuditLog>>;
		memberAuditLog(
			serverId: string,
			userId: string,
			params?: PaginatedQuery & { action?: string }
		): Promise<Page<AuditLog>>;
		createInvite(id: string, data?: CreateInviteInput): Promise<{ code: string }>;
		listInvites(id: string, params?: PaginatedQuery): Promise<Page<ServerInvite>>;
		deleteInvite(id: string, code: string): Promise<{ success: true }>;
		updateInvite(id: string, code: string, data: UpdateInviteInput): Promise<ServerInvite>;
		trashChannels(id: string): Promise<TrashChannelEntry[]>;
		trashRoles(id: string): Promise<TrashRoleEntry[]>;
		trashMessages(id: string, params?: PaginatedQuery & Record<string, unknown>): Promise<Page<TrashMessageEntry>>;
	};
	invites: {
		preview(code: string): Promise<InvitePreview>;
		join(code: string): Promise<{ server_id: string }>;
	};
	roles: {
		list(serverId: string): Promise<ServerRole[]>;
		create(serverId: string, data: CreateRoleInput): Promise<ServerRole>;
		update(roleId: string, data: UpdateRoleInput): Promise<ServerRole>;
		delete(roleId: string): Promise<{ success: boolean }>;
		swap(roleId: string, otherRoleId: string): Promise<{ success: boolean }>;
		reorder(serverId: string, roleIds: string[]): Promise<{ success: boolean }>;
		assign(serverId: string, userId: string, roleId: string): Promise<{ success: boolean }>;
		unassign(serverId: string, userId: string, roleId: string): Promise<{ success: boolean }>;
		myPermissions(serverId: string): Promise<MyPermissions>;
		permissionTree(serverId: string, userId: string): Promise<PermissionTree>;
		memberPermissions(serverId: string, userId: string): Promise<MemberPermissionsView>;
		restore(roleId: string): Promise<ServerRole>;
		hardDelete(roleId: string): Promise<{ success: boolean }>;
	};
	channels: {
		messages(
			id: string,
			options?: { before?: string; limit?: number; include_deleted?: boolean }
		): Promise<Message[]>;
		send(id: string, data: SendMessageInput): Promise<Message>;
		editMessage(channelId: string, messageId: string, content: string): Promise<Message>;
		deleteMessage(channelId: string, messageId: string): Promise<{ success: boolean }>;
		clearEmbeds(channelId: string, messageId: string): Promise<Message>;
		addReaction(channelId: string, messageId: string, kind: string, value: string): Promise<Message>;
		pins(id: string, options?: { include_deleted?: boolean }): Promise<Message[]>;
		pin(channelId: string, messageId: string): Promise<{ success: boolean }>;
		unpin(channelId: string, messageId: string): Promise<{ success: boolean }>;
		typing(id: string): Promise<{ success: boolean }>;
		update(id: string, data: UpdateChannelInput): Promise<Channel>;
		delete(id: string): Promise<{ success: boolean }>;
		restore(id: string): Promise<Channel>;
		hardDelete(id: string): Promise<{ success: boolean }>;
		restoreMessage(channelId: string, messageId: string): Promise<Message>;
		hardDeleteMessage(channelId: string, messageId: string): Promise<{ success: boolean }>;
		reorder(serverId: string, body: ChannelReorderInput): Promise<{ success: boolean }>;
	};
	uploads: {
		presign(data: UploadPresignInput): Promise<UploadPresignResponse>;
		finalize(uploadId: string, data: UploadFinalizeInput): Promise<UploadFinalizeResponse>;
	};
	users: {
		me(): Promise<User>;
		resolve(q: string): Promise<UserResolveResult>;
		updateMe(data: UpdateMyselfInput): Promise<User>;
		dmChannels(): Promise<DmChannelSummary[]>;
		createDM(recipientId: string, syrInstanceUrl?: string): Promise<{ id: string; type: string }>;
	};
	relations: {
		snapshot(): Promise<RelationsSnapshot>;
		listFriends(params?: PaginatedQuery): Promise<Page<{ user_id: string }>>;
		listBlocked(params?: PaginatedQuery): Promise<
			Page<{ blocker_id: string; blocked_id: string; created_at: string }>
		>;
		listIgnored(params?: PaginatedQuery): Promise<
			Page<{ user_id: string; ignored_id: string; created_at: string }>
		>;
		sendRequest(userId: string, syrInstanceUrl?: string): Promise<Friendship>;
		accept(userId: string): Promise<Friendship>;
		decline(userId: string): Promise<{ success: boolean }>;
		cancelOrRemove(userId: string): Promise<{ success: boolean }>;
		block(userId: string): Promise<{ success: boolean }>;
		unblock(userId: string): Promise<{ success: boolean }>;
		ignore(userId: string): Promise<{ success: boolean }>;
		unignore(userId: string): Promise<{ success: boolean }>;
	};
	voice: {
		token(channelId: string): Promise<VoiceTokenResponse>;
	};
	categories: {
		list(serverId: string): Promise<ChannelCategory[]>;
		create(serverId: string, data: { name: string }): Promise<ChannelCategory>;
		update(categoryId: string, data: { name?: string }): Promise<ChannelCategory>;
		delete(categoryId: string): Promise<{ success: boolean }>;
		swap(a: string, b: string): Promise<{ success: boolean }>;
		reorder(serverId: string, categoryIds: string[]): Promise<{ success: boolean }>;
	};
	overrides: {
		list(serverId: string): Promise<PermissionOverride[]>;
		forChannel(serverId: string, channelId: string): Promise<PermissionOverride[]>;
		forCategory(serverId: string, categoryId: string): Promise<PermissionOverride[]>;
		upsert(serverId: string, data: UpsertOverrideInput): Promise<PermissionOverride>;
		delete(serverId: string, overrideId: string): Promise<{ success: boolean }>;
	};
	/**
	 * Release the underlying WASM Client allocation. Idempotent — safe
	 * to call from a route load() before reinitialising for a different
	 * API host. Without this, the prior Client lingers until GC even
	 * though it can't be reached from JS.
	 */
	dispose(): void;
}

// All return casts below are the trust-the-server pattern the legacy
// api.ts already used. Server-side validation guarantees the shape;
// the WASM transport just JSON-deserialises. If we ever want runtime
// validation we drop the corresponding `Schema.parse(raw)` here.
function wrap(c: WasmClient): SyrenClient {
	return {
		auth: {
			me: () => c.me(),
			login: (i, r) => c.login_start(i, r),
			logout: async () => {
				await c.logout();
				return { success: true };
			},
			exchange: (code) => c.login_complete(code)
		},
		servers: {
			list: () => c.servers_list() as Promise<Server[]>,
			create: (data) => c.server_create(data) as Promise<Server>,
			get: (id) => c.server_get(id) as Promise<Server>,
			update: (id, data) => c.server_update(id, data) as Promise<Server>,
			delete: (id) => c.server_delete(id) as Promise<{ success: boolean }>,
			leave: (id) => c.server_leave(id) as Promise<{ success: boolean }>,
			transferOwnership: (id, newOwnerId) =>
				c.server_transfer_ownership(id, newOwnerId) as Promise<{ server: Server; former_owner_role_id: string }>,
			channels: (id) => c.server_channels(id) as Promise<Channel[]>,
			members: (id) => c.server_members(id) as Promise<ServerMember[]>,
			membersPage: (id, params = {}) =>
				c.server_members_page(id, params) as Promise<Page<ServerMember>>,
			voiceStates: (id) => c.server_voice_states(id) as Promise<VoiceStatesByChannel>,
			createChannel: (id, data) => c.server_create_channel(id, data) as Promise<Channel>,
			kickMember: (sid, uid, opts) =>
				c.member_kick(sid, uid, opts?.delete_seconds) as Promise<{ success: boolean }>,
			banMember: (sid, body) => c.member_ban(sid, body) as Promise<ServerBan>,
			unbanMember: (sid, uid) => c.member_unban(sid, uid) as Promise<{ success: boolean }>,
			listBans: (sid, params = {}) => c.list_bans(sid, params) as Promise<Page<ServerBan>>,
			memberMessages: (sid, uid, params = {}) =>
				c.member_messages(sid, uid, params) as Promise<Page<MemberMessageEntry>>,
			memberMessageStats: (sid, uid) =>
				c.member_message_stats(sid, uid) as Promise<MemberMessageStats>,
			purgeMemberMessages: (sid, uid, body) =>
				c.purge_member_messages(sid, uid, body) as Promise<{ success: boolean }>,
			memberBanHistory: (sid, uid) =>
				c.member_ban_history(sid, uid) as Promise<ServerBan[]>,
			auditLog: (sid, params = {}) => c.audit_log(sid, params) as Promise<Page<AuditLog>>,
			memberAuditLog: (sid, uid, params = {}) =>
				c.member_audit_log(sid, uid, params) as Promise<Page<AuditLog>>,
			createInvite: (id, data = {}) =>
				c.invites_create(id, data) as Promise<{ code: string }>,
			listInvites: (id, params = {}) =>
				c.invites_list(id, params) as Promise<Page<ServerInvite>>,
			deleteInvite: (id, code) => c.invite_delete(id, code) as Promise<{ success: true }>,
			updateInvite: (id, code, data) =>
				c.update_invite(id, code, data) as Promise<ServerInvite>,
			trashChannels: (id) => c.trash_channels(id) as Promise<TrashChannelEntry[]>,
			trashRoles: (id) => c.trash_roles(id) as Promise<TrashRoleEntry[]>,
			trashMessages: (id, params = {}) =>
				c.trash_messages(id, params) as Promise<Page<TrashMessageEntry>>
		},
		invites: {
			preview: (code) => c.invite_preview(code) as Promise<InvitePreview>,
			join: (code) => c.invite_join(code) as Promise<{ server_id: string }>
		},
		roles: {
			list: (sid) => c.roles_list(sid) as Promise<ServerRole[]>,
			create: (sid, data) => c.role_create(sid, data) as Promise<ServerRole>,
			update: (rid, data) => c.role_update(rid, data) as Promise<ServerRole>,
			delete: (rid) => c.role_delete(rid) as Promise<{ success: boolean }>,
			swap: (a, b) => c.role_swap(a, b) as Promise<{ success: boolean }>,
			reorder: (sid, ids) => c.role_reorder(sid, ids) as Promise<{ success: boolean }>,
			assign: (sid, uid, rid) =>
				c.role_assign(sid, uid, rid) as Promise<{ success: boolean }>,
			unassign: (sid, uid, rid) =>
				c.role_unassign(sid, uid, rid) as Promise<{ success: boolean }>,
			myPermissions: (sid) => c.my_permissions(sid) as Promise<MyPermissions>,
			permissionTree: (sid, uid) =>
				c.role_permission_tree(sid, uid) as Promise<PermissionTree>,
			memberPermissions: (sid, uid) =>
				c.role_member_permissions(sid, uid) as Promise<MemberPermissionsView>,
			restore: (rid) => c.role_restore(rid) as Promise<ServerRole>,
			hardDelete: (rid) => c.role_hard_delete(rid) as Promise<{ success: boolean }>
		},
		channels: {
			messages: (id, opts) =>
				c.channel_messages(id, opts?.before, opts?.limit, opts?.include_deleted) as Promise<Message[]>,
			send: (id, data) => c.channel_send(id, data) as Promise<Message>,
			editMessage: (cid, mid, content) =>
				c.channel_edit_message(cid, mid, content) as Promise<Message>,
			deleteMessage: (cid, mid) =>
				c.channel_delete_message(cid, mid) as Promise<{ success: boolean }>,
			clearEmbeds: (cid, mid) => c.channel_clear_embeds(cid, mid) as Promise<Message>,
			addReaction: (cid, mid, kind, value) =>
				c.channel_add_reaction(cid, mid, kind, value) as Promise<Message>,
			pins: (id, opts) => c.channel_pins(id, opts?.include_deleted) as Promise<Message[]>,
			pin: (cid, mid) => c.channel_pin(cid, mid) as Promise<{ success: boolean }>,
			unpin: (cid, mid) => c.channel_unpin(cid, mid) as Promise<{ success: boolean }>,
			typing: (id) => c.channel_typing(id) as Promise<{ success: boolean }>,
			update: (id, data) => c.channel_update(id, data) as Promise<Channel>,
			delete: (id) => c.channel_delete(id) as Promise<{ success: boolean }>,
			restore: (id) => c.channel_restore(id) as Promise<Channel>,
			hardDelete: (id) => c.channel_hard_delete(id) as Promise<{ success: boolean }>,
			restoreMessage: (cid, mid) =>
				c.channel_restore_message(cid, mid) as Promise<Message>,
			hardDeleteMessage: (cid, mid) =>
				c.channel_hard_delete_message(cid, mid) as Promise<{ success: boolean }>,
			reorder: (sid, body) => c.channel_reorder(sid, body) as Promise<{ success: boolean }>
		},
		uploads: {
			presign: (data) => c.upload_presign(data) as Promise<UploadPresignResponse>,
			finalize: (id, data) =>
				c.upload_finalize(id, data) as Promise<UploadFinalizeResponse>
		},
		users: {
			me: () => c.users_me() as Promise<User>,
			resolve: (q) => c.users_resolve(q) as Promise<UserResolveResult>,
			updateMe: (data) => c.users_update_me(data) as Promise<User>,
			dmChannels: () => c.dm_channels() as Promise<DmChannelSummary[]>,
			createDM: (rid, instance) =>
				c.create_dm(rid, instance) as Promise<{ id: string; type: string }>
		},
		relations: {
			snapshot: () => c.relations_snapshot() as Promise<RelationsSnapshot>,
			listFriends: (params = {}) =>
				c.list_friends(params) as Promise<Page<{ user_id: string }>>,
			listBlocked: (params = {}) =>
				c.list_blocked(params) as Promise<
					Page<{ blocker_id: string; blocked_id: string; created_at: string }>
				>,
			listIgnored: (params = {}) =>
				c.list_ignored(params) as Promise<
					Page<{ user_id: string; ignored_id: string; created_at: string }>
				>,
			sendRequest: (uid, instance) =>
				c.friend_send(uid, instance) as Promise<Friendship>,
			accept: (uid) => c.friend_accept(uid) as Promise<Friendship>,
			decline: (uid) => c.friend_decline(uid) as Promise<{ success: boolean }>,
			cancelOrRemove: (uid) => c.friend_remove(uid) as Promise<{ success: boolean }>,
			block: (uid) => c.block(uid) as Promise<{ success: boolean }>,
			unblock: (uid) => c.unblock(uid) as Promise<{ success: boolean }>,
			ignore: (uid) => c.ignore(uid) as Promise<{ success: boolean }>,
			unignore: (uid) => c.unignore(uid) as Promise<{ success: boolean }>
		},
		voice: {
			token: (cid) => c.voice_token(cid) as Promise<VoiceTokenResponse>
		},
		categories: {
			list: (sid) => c.categories_list(sid) as Promise<ChannelCategory[]>,
			create: (sid, data) => c.category_create(sid, data.name) as Promise<ChannelCategory>,
			update: (cid, data) => c.category_update(cid, data) as Promise<ChannelCategory>,
			delete: (cid) => c.category_delete(cid) as Promise<{ success: boolean }>,
			swap: (a, b) => c.category_swap(a, b) as Promise<{ success: boolean }>,
			reorder: (sid, ids) =>
				c.category_reorder(sid, ids) as Promise<{ success: boolean }>
		},
		overrides: {
			list: (sid) => c.overrides_list(sid) as Promise<PermissionOverride[]>,
			forChannel: (sid, cid) =>
				c.overrides_for_channel(sid, cid) as Promise<PermissionOverride[]>,
			forCategory: (sid, catId) =>
				c.overrides_for_category(sid, catId) as Promise<PermissionOverride[]>,
			upsert: (sid, data) => c.override_upsert(sid, data) as Promise<PermissionOverride>,
			delete: (sid, oid) =>
				c.override_delete(sid, oid) as Promise<{ success: boolean }>
		},
		dispose: () => {
			// `free` is generated by wasm-bindgen and throws on a
			// double-call; swallow so callers can be defensive.
			try {
				c.free?.();
			} catch {
				/* already freed */
			}
		}
	};
}

// Re-export the source-of-truth types so consumers can `import { Server } from '@syren/client'`
// without depending on `@syren/types` directly when they don't need the schemas.
export type {
	Server,
	ServerMember,
	ServerInvite,
	ServerBan,
	ServerRole,
	Channel,
	ChannelCategory,
	Message,
	Attachment,
	AuditLog,
	Friendship,
	PermissionOverride,
	Presence,
	User
};

// Keep a `Json` alias for the rare consumer that wants the raw shape
// (e.g. dynamic moderation payloads we don't have a schema for yet).
export type Json = unknown;
