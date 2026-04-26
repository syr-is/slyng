/**
 * Lazy-init wrapper that loads the WASM bundle exactly once and
 * re-exposes every method on the Rust `Client` as a typed async
 * function organised in nested namespaces (`api.servers.list()`,
 * `api.channels.send(...)`, …) — same shape the legacy
 * `@syren/app-core/api` shim used to provide, except every method now
 * goes through the same Rust transport (bearer auth, error parsing)
 * the native shell already uses, with no per-endpoint TS↔WASM
 * binding to maintain on the consumer side.
 */

export interface Identity {
	did: string;
	syr_instance_url: string;
	delegate_public_key?: string;
	trusted_domains?: string[];
	allow_dms?: 'open' | 'friends_only' | 'closed';
	allow_friend_requests?: 'open' | 'mutual' | 'closed';
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

export type Json = unknown;

interface WasmExports {
	default?: (() => Promise<unknown>) | unknown;
	Client: new (baseUrl: string, sessionKey?: string) => WasmClient;
}

// ── Raw WASM surface (snake_case mirror of the Rust impl) ──
//
// Every method on the Rust `Client` (in packages/rust/syren-client/src/
// {auth,servers,channels,roles,users,relations,categories,invites,
// uploads,voice,overrides}.rs) is exposed by `wasm.rs` and bound here.
// Update on both sides when adding endpoints.
interface WasmClient {
	// auth
	login_start(instance_url: string, redirect?: string): Promise<LoginResponse>;
	login_complete(code: string): Promise<Identity>;
	me(): Promise<Identity>;
	logout(): Promise<void>;
	// servers
	servers_list(): Promise<Json[]>;
	server_get(id: string): Promise<Json>;
	server_create(data: Json): Promise<Json>;
	server_update(id: string, data: Json): Promise<Json>;
	server_delete(id: string): Promise<Json>;
	server_leave(id: string): Promise<Json>;
	server_transfer_ownership(server_id: string, new_owner_id: string): Promise<Json>;
	server_channels(id: string): Promise<Json[]>;
	server_members(id: string): Promise<Json[]>;
	server_members_page(id: string, params: PaginatedQuery): Promise<Page>;
	server_voice_states(id: string): Promise<Json>;
	server_create_channel(server_id: string, data: Json): Promise<Json>;
	member_kick(server_id: string, user_id: string): Promise<Json>;
	member_ban(server_id: string, body: Json): Promise<Json>;
	member_unban(server_id: string, user_id: string): Promise<Json>;
	list_bans(server_id: string, params: Json): Promise<Page>;
	member_messages(server_id: string, user_id: string, params: Json): Promise<Page>;
	member_message_stats(server_id: string, user_id: string): Promise<Json>;
	purge_member_messages(server_id: string, user_id: string, body: Json): Promise<Json>;
	member_ban_history(server_id: string, user_id: string): Promise<Json[]>;
	audit_log(server_id: string, params: Json): Promise<Page>;
	member_audit_log(server_id: string, user_id: string, params: Json): Promise<Page>;
	// invites
	invite_preview(code: string): Promise<Json>;
	invite_join(code: string): Promise<Json>;
	invites_create(server_id: string, data: Json): Promise<Json>;
	invites_list(server_id: string, params: PaginatedQuery): Promise<Page>;
	invite_delete(server_id: string, code: string): Promise<Json>;
	update_invite(server_id: string, code: string, data: Json): Promise<Json>;
	// trash
	trash_channels(server_id: string): Promise<Json[]>;
	trash_roles(server_id: string): Promise<Json[]>;
	trash_messages(server_id: string, params: Json): Promise<Page>;
	// channels
	channel_messages(id: string, before?: string, limit?: number, include_deleted?: boolean): Promise<Json[]>;
	channel_send(id: string, body: Json): Promise<Json>;
	channel_edit_message(channel_id: string, message_id: string, content: string): Promise<Json>;
	channel_delete_message(channel_id: string, message_id: string): Promise<Json>;
	channel_clear_embeds(channel_id: string, message_id: string): Promise<Json>;
	channel_add_reaction(channel_id: string, message_id: string, kind: string, value: string): Promise<Json>;
	channel_pins(id: string, include_deleted?: boolean): Promise<Json[]>;
	channel_pin(channel_id: string, message_id: string): Promise<Json>;
	channel_unpin(channel_id: string, message_id: string): Promise<Json>;
	channel_typing(id: string): Promise<Json>;
	channel_update(id: string, data: Json): Promise<Json>;
	channel_delete(id: string): Promise<Json>;
	channel_restore(id: string): Promise<Json>;
	channel_hard_delete(id: string): Promise<Json>;
	channel_restore_message(channel_id: string, message_id: string): Promise<Json>;
	channel_hard_delete_message(channel_id: string, message_id: string): Promise<Json>;
	channel_reorder(server_id: string, body: Json): Promise<Json>;
	// roles
	roles_list(server_id: string): Promise<Json[]>;
	role_create(server_id: string, data: Json): Promise<Json>;
	role_update(role_id: string, data: Json): Promise<Json>;
	role_delete(role_id: string): Promise<Json>;
	role_swap(role_id: string, other_role_id: string): Promise<Json>;
	role_assign(server_id: string, user_id: string, role_id: string): Promise<Json>;
	role_unassign(server_id: string, user_id: string, role_id: string): Promise<Json>;
	role_reorder(server_id: string, role_ids: string[]): Promise<Json>;
	my_permissions(server_id: string): Promise<Json>;
	role_permission_tree(server_id: string, user_id: string): Promise<Json>;
	role_member_permissions(server_id: string, user_id: string): Promise<Json>;
	role_restore(role_id: string): Promise<Json>;
	role_hard_delete(role_id: string): Promise<Json>;
	// categories
	categories_list(server_id: string): Promise<Json[]>;
	category_create(server_id: string, name: string): Promise<Json>;
	category_update(category_id: string, data: Json): Promise<Json>;
	category_delete(category_id: string): Promise<Json>;
	category_swap(a: string, b: string): Promise<Json>;
	category_reorder(server_id: string, ids: string[]): Promise<Json>;
	// users
	users_me(): Promise<Json>;
	users_resolve(q: string): Promise<Json>;
	users_update_me(data: Json): Promise<Json>;
	dm_channels(): Promise<Json[]>;
	create_dm(recipient_id: string, syr_instance_url?: string): Promise<Json>;
	// relations
	relations_snapshot(): Promise<Json>;
	list_friends(params: Json): Promise<Page>;
	list_blocked(params: Json): Promise<Page>;
	list_ignored(params: Json): Promise<Page>;
	friend_send(user_id: string, syr_instance_url?: string): Promise<Json>;
	friend_accept(user_id: string): Promise<Json>;
	friend_decline(user_id: string): Promise<Json>;
	friend_remove(user_id: string): Promise<Json>;
	block(user_id: string): Promise<Json>;
	unblock(user_id: string): Promise<Json>;
	ignore(user_id: string): Promise<Json>;
	unignore(user_id: string): Promise<Json>;
	// voice
	voice_token(channel_id: string): Promise<Json>;
	// uploads
	upload_presign(body: Json): Promise<Json>;
	upload_finalize(upload_id: string, body: Json): Promise<Json>;
	// permission overrides
	overrides_list(server_id: string): Promise<Json[]>;
	overrides_for_channel(server_id: string, channel_id: string): Promise<Json[]>;
	overrides_for_category(server_id: string, category_id: string): Promise<Json[]>;
	override_upsert(server_id: string, body: Json): Promise<Json>;
	override_delete(server_id: string, override_id: string): Promise<Json>;
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
			// `@syren/client/wasm` resolves to the browser bundle in a
			// browser-targeted build (Vite, esbuild) and to the
			// nodejs-target bundle under Node thanks to the
			// `package.json` `exports` conditions. We use a plain
			// dynamic import so the host bundler can statically
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

/**
 * Creates and returns a typed handle. The first call lazily fetches
 * and instantiates the WASM module; subsequent calls reuse it.
 *
 * @param baseUrl  API host root (e.g. `https://app.slyng.gg`).
 * @param opts.sessionKey  localStorage key under which the bearer
 *   token is persisted. Defaults to `syren_session`.
 */
export async function initSyrenClient(
	baseUrl: string,
	opts: { sessionKey?: string } = {}
): Promise<SyrenClient> {
	const m = await loadWasm();
	const inner = new m.Client(baseUrl, opts.sessionKey ?? 'syren_session');
	return wrap(inner);
}

// ─────────────────────────────────────────────────────────────────
// Public typed surface — mirrors the legacy api.ts namespacing.
// ─────────────────────────────────────────────────────────────────

export interface SyrenClient {
	auth: {
		me(): Promise<Identity>;
		login(instanceUrl: string, redirect?: string): Promise<LoginResponse>;
		logout(): Promise<{ success: boolean }>;
		exchange(code: string): Promise<Identity>;
	};
	servers: {
		list(): Promise<Json[]>;
		create(data: Json): Promise<Json>;
		get(id: string): Promise<Json>;
		update(id: string, data: Json): Promise<Json>;
		delete(id: string): Promise<Json>;
		leave(id: string): Promise<Json>;
		transferOwnership(id: string, newOwnerId: string): Promise<Json>;
		channels(id: string): Promise<Json[]>;
		members(id: string): Promise<Json[]>;
		membersPage(id: string, params?: PaginatedQuery): Promise<Page>;
		voiceStates(id: string): Promise<Json>;
		createChannel(id: string, data: Json): Promise<Json>;
		kickMember(serverId: string, userId: string): Promise<Json>;
		banMember(serverId: string, body: Json): Promise<Json>;
		unbanMember(serverId: string, userId: string): Promise<Json>;
		listBans(serverId: string, params?: Json): Promise<Page>;
		memberMessages(serverId: string, userId: string, params?: Json): Promise<Page>;
		memberMessageStats(serverId: string, userId: string): Promise<Json>;
		purgeMemberMessages(serverId: string, userId: string, body: Json): Promise<Json>;
		memberBanHistory(serverId: string, userId: string): Promise<Json[]>;
		auditLog(serverId: string, params?: Json): Promise<Page>;
		memberAuditLog(serverId: string, userId: string, params?: Json): Promise<Page>;
		createInvite(id: string, data?: Json): Promise<Json>;
		listInvites(id: string, params?: PaginatedQuery): Promise<Page>;
		deleteInvite(id: string, code: string): Promise<Json>;
		updateInvite(id: string, code: string, data: Json): Promise<Json>;
		trashChannels(id: string): Promise<Json[]>;
		trashRoles(id: string): Promise<Json[]>;
		trashMessages(id: string, params?: Json): Promise<Page>;
	};
	invites: {
		preview(code: string): Promise<Json>;
		join(code: string): Promise<Json>;
	};
	roles: {
		list(serverId: string): Promise<Json[]>;
		create(serverId: string, data: Json): Promise<Json>;
		update(roleId: string, data: Json): Promise<Json>;
		delete(roleId: string): Promise<Json>;
		swap(roleId: string, otherRoleId: string): Promise<Json>;
		reorder(serverId: string, roleIds: string[]): Promise<Json>;
		assign(serverId: string, userId: string, roleId: string): Promise<Json>;
		unassign(serverId: string, userId: string, roleId: string): Promise<Json>;
		myPermissions(serverId: string): Promise<Json>;
		permissionTree(serverId: string, userId: string): Promise<Json>;
		memberPermissions(serverId: string, userId: string): Promise<Json>;
		restore(roleId: string): Promise<Json>;
		hardDelete(roleId: string): Promise<Json>;
	};
	channels: {
		messages(
			id: string,
			options?: { before?: string; limit?: number; include_deleted?: boolean }
		): Promise<Json[]>;
		send(id: string, data: Json): Promise<Json>;
		editMessage(channelId: string, messageId: string, content: string): Promise<Json>;
		deleteMessage(channelId: string, messageId: string): Promise<Json>;
		clearEmbeds(channelId: string, messageId: string): Promise<Json>;
		addReaction(channelId: string, messageId: string, kind: string, value: string): Promise<Json>;
		pins(id: string, options?: { include_deleted?: boolean }): Promise<Json[]>;
		pin(channelId: string, messageId: string): Promise<Json>;
		unpin(channelId: string, messageId: string): Promise<Json>;
		typing(id: string): Promise<Json>;
		update(id: string, data: Json): Promise<Json>;
		delete(id: string): Promise<Json>;
		restore(id: string): Promise<Json>;
		hardDelete(id: string): Promise<Json>;
		restoreMessage(channelId: string, messageId: string): Promise<Json>;
		hardDeleteMessage(channelId: string, messageId: string): Promise<Json>;
		reorder(serverId: string, body: Json): Promise<Json>;
	};
	uploads: {
		presign(data: Json): Promise<Json>;
		finalize(uploadId: string, data: Json): Promise<Json>;
	};
	users: {
		me(): Promise<Json>;
		resolve(q: string): Promise<Json>;
		updateMe(data: Json): Promise<Json>;
		dmChannels(): Promise<Json[]>;
		createDM(recipientId: string, syrInstanceUrl?: string): Promise<Json>;
	};
	relations: {
		snapshot(): Promise<Json>;
		listFriends(params?: Json): Promise<Page>;
		listBlocked(params?: Json): Promise<Page>;
		listIgnored(params?: Json): Promise<Page>;
		sendRequest(userId: string, syrInstanceUrl?: string): Promise<Json>;
		accept(userId: string): Promise<Json>;
		decline(userId: string): Promise<Json>;
		cancelOrRemove(userId: string): Promise<Json>;
		block(userId: string): Promise<Json>;
		unblock(userId: string): Promise<Json>;
		ignore(userId: string): Promise<Json>;
		unignore(userId: string): Promise<Json>;
	};
	voice: {
		token(channelId: string): Promise<Json>;
	};
	categories: {
		list(serverId: string): Promise<Json[]>;
		create(serverId: string, data: { name: string }): Promise<Json>;
		update(categoryId: string, data: Json): Promise<Json>;
		delete(categoryId: string): Promise<Json>;
		swap(a: string, b: string): Promise<Json>;
		reorder(serverId: string, categoryIds: string[]): Promise<Json>;
	};
	overrides: {
		list(serverId: string): Promise<Json[]>;
		forChannel(serverId: string, channelId: string): Promise<Json[]>;
		forCategory(serverId: string, categoryId: string): Promise<Json[]>;
		upsert(serverId: string, data: Json): Promise<Json>;
		delete(serverId: string, overrideId: string): Promise<Json>;
	};
}

function wrap(c: WasmClient): SyrenClient {
	return {
		auth: {
			me: () => c.me(),
			login: (i, r) => c.login_start(i, r),
			// `logout()` returns `void` from the WASM side; api.ts callers
			// expected `{ success: boolean }`, so wrap.
			logout: async () => {
				await c.logout();
				return { success: true };
			},
			// The bridge-code exchange — `login_complete` calls
			// /auth/exchange and /auth/me internally and returns Identity.
			exchange: (code) => c.login_complete(code)
		},
		servers: {
			list: () => c.servers_list(),
			create: (data) => c.server_create(data as Json),
			get: (id) => c.server_get(id),
			update: (id, data) => c.server_update(id, data as Json),
			delete: (id) => c.server_delete(id),
			leave: (id) => c.server_leave(id),
			transferOwnership: (id, newOwnerId) => c.server_transfer_ownership(id, newOwnerId),
			channels: (id) => c.server_channels(id),
			members: (id) => c.server_members(id),
			membersPage: (id, params = {}) => c.server_members_page(id, params),
			voiceStates: (id) => c.server_voice_states(id),
			createChannel: (id, data) => c.server_create_channel(id, data as Json),
			kickMember: (sid, uid) => c.member_kick(sid, uid),
			banMember: (sid, body) => c.member_ban(sid, body as Json),
			unbanMember: (sid, uid) => c.member_unban(sid, uid),
			listBans: (sid, params = {}) => c.list_bans(sid, params as Json),
			memberMessages: (sid, uid, params = {}) => c.member_messages(sid, uid, params as Json),
			memberMessageStats: (sid, uid) => c.member_message_stats(sid, uid),
			purgeMemberMessages: (sid, uid, body) => c.purge_member_messages(sid, uid, body as Json),
			memberBanHistory: (sid, uid) => c.member_ban_history(sid, uid),
			auditLog: (sid, params = {}) => c.audit_log(sid, params as Json),
			memberAuditLog: (sid, uid, params = {}) => c.member_audit_log(sid, uid, params as Json),
			createInvite: (id, data = {}) => c.invites_create(id, data as Json),
			listInvites: (id, params = {}) => c.invites_list(id, params),
			deleteInvite: (id, code) => c.invite_delete(id, code),
			updateInvite: (id, code, data) => c.update_invite(id, code, data as Json),
			trashChannels: (id) => c.trash_channels(id),
			trashRoles: (id) => c.trash_roles(id),
			trashMessages: (id, params = {}) => c.trash_messages(id, params as Json)
		},
		invites: {
			preview: (code) => c.invite_preview(code),
			join: (code) => c.invite_join(code)
		},
		roles: {
			list: (sid) => c.roles_list(sid),
			create: (sid, data) => c.role_create(sid, data as Json),
			update: (rid, data) => c.role_update(rid, data as Json),
			delete: (rid) => c.role_delete(rid),
			swap: (a, b) => c.role_swap(a, b),
			reorder: (sid, ids) => c.role_reorder(sid, ids),
			assign: (sid, uid, rid) => c.role_assign(sid, uid, rid),
			unassign: (sid, uid, rid) => c.role_unassign(sid, uid, rid),
			myPermissions: (sid) => c.my_permissions(sid),
			permissionTree: (sid, uid) => c.role_permission_tree(sid, uid),
			memberPermissions: (sid, uid) => c.role_member_permissions(sid, uid),
			restore: (rid) => c.role_restore(rid),
			hardDelete: (rid) => c.role_hard_delete(rid)
		},
		channels: {
			messages: (id, opts) => c.channel_messages(id, opts?.before, opts?.limit, opts?.include_deleted),
			send: (id, data) => c.channel_send(id, data as Json),
			editMessage: (cid, mid, content) => c.channel_edit_message(cid, mid, content),
			deleteMessage: (cid, mid) => c.channel_delete_message(cid, mid),
			clearEmbeds: (cid, mid) => c.channel_clear_embeds(cid, mid),
			addReaction: (cid, mid, kind, value) => c.channel_add_reaction(cid, mid, kind, value),
			pins: (id, opts) => c.channel_pins(id, opts?.include_deleted),
			pin: (cid, mid) => c.channel_pin(cid, mid),
			unpin: (cid, mid) => c.channel_unpin(cid, mid),
			typing: (id) => c.channel_typing(id),
			update: (id, data) => c.channel_update(id, data as Json),
			delete: (id) => c.channel_delete(id),
			restore: (id) => c.channel_restore(id),
			hardDelete: (id) => c.channel_hard_delete(id),
			restoreMessage: (cid, mid) => c.channel_restore_message(cid, mid),
			hardDeleteMessage: (cid, mid) => c.channel_hard_delete_message(cid, mid),
			reorder: (sid, body) => c.channel_reorder(sid, body as Json)
		},
		uploads: {
			presign: (data) => c.upload_presign(data as Json),
			finalize: (id, data) => c.upload_finalize(id, data as Json)
		},
		users: {
			me: () => c.users_me(),
			resolve: (q) => c.users_resolve(q),
			updateMe: (data) => c.users_update_me(data as Json),
			dmChannels: () => c.dm_channels(),
			createDM: (rid, instance) => c.create_dm(rid, instance)
		},
		relations: {
			snapshot: () => c.relations_snapshot(),
			listFriends: (params = {}) => c.list_friends(params as Json),
			listBlocked: (params = {}) => c.list_blocked(params as Json),
			listIgnored: (params = {}) => c.list_ignored(params as Json),
			sendRequest: (uid, instance) => c.friend_send(uid, instance),
			accept: (uid) => c.friend_accept(uid),
			decline: (uid) => c.friend_decline(uid),
			cancelOrRemove: (uid) => c.friend_remove(uid),
			block: (uid) => c.block(uid),
			unblock: (uid) => c.unblock(uid),
			ignore: (uid) => c.ignore(uid),
			unignore: (uid) => c.unignore(uid)
		},
		voice: {
			token: (cid) => c.voice_token(cid)
		},
		categories: {
			list: (sid) => c.categories_list(sid),
			create: (sid, data) => c.category_create(sid, data.name),
			update: (cid, data) => c.category_update(cid, data as Json),
			delete: (cid) => c.category_delete(cid),
			swap: (a, b) => c.category_swap(a, b),
			reorder: (sid, ids) => c.category_reorder(sid, ids)
		},
		overrides: {
			list: (sid) => c.overrides_list(sid),
			forChannel: (sid, cid) => c.overrides_for_channel(sid, cid),
			forCategory: (sid, catId) => c.overrides_for_category(sid, catId),
			upsert: (sid, data) => c.override_upsert(sid, data as Json),
			delete: (sid, oid) => c.override_delete(sid, oid)
		}
	};
}
