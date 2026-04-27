/**
 * Native `SyrenClient` implementation. One `invoke('command_name', args)`
 * per method, no WASM in the WebView. Types come from `@syren/client`,
 * which itself re-exports them from the wasm-pack `.d.ts` (auto-derived
 * from `syren-types`'s Rust structs via tsify-next).
 *
 * The shape mirrors `@syren/app-core/api`'s contract exactly: every
 * downstream consumer (`api.servers.list()`, `api.channels.send(…)`, …)
 * works the same regardless of whether the host is web (WASM) or
 * native (this).
 */

import { invoke } from '@tauri-apps/api/core';
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
	SyrenClient,
	TransferOwnershipResponse,
	TrashChannelEntry,
	TrashMessageEntry,
	TrashRoleEntry,
	UploadFinalizeResponse,
	UploadPresignResponse,
	User,
	UserResolveResult,
	VoiceTokenResponse
} from '@syren/client';

/** Build a `SyrenClient` whose calls go through Tauri IPC for the given host. */
export function createNativeApi(apiHost: string): SyrenClient {
	const c = (cmd: string, extra: Record<string, unknown> = {}) => ({ apiHost, ...extra });

	return {
		auth: {
			me: () => invoke<Identity>('me', c('me')),
			login: (instanceUrl, redirect) =>
				invoke<LoginResponse>('start_login', c('start_login', { instanceUrl, redirect })),
			logout: async () => {
				await invoke<void>('logout');
				return { success: true };
			},
			exchange: (code) => invoke<Identity>('login_complete', c('login_complete', { code }))
		},
		servers: {
			list: () => invoke<Server[]>('servers_list', c('servers_list')),
			create: (data) => invoke<Server>('server_create', c('server_create', { data })),
			get: (id) => invoke<Server>('server_get', c('server_get', { id })),
			update: (id, data) => invoke<Server>('server_update', c('server_update', { id, data })),
			delete: (id) => invoke<SuccessResponse>('server_delete', c('server_delete', { id })),
			leave: (id) => invoke<SuccessResponse>('server_leave', c('server_leave', { id })),
			transferOwnership: (id, newOwnerId) =>
				invoke<TransferOwnershipResponse>(
					'server_transfer_ownership',
					c('server_transfer_ownership', { id, newOwnerId })
				),
			channels: (id) => invoke<Channel[]>('server_channels', c('server_channels', { id })),
			members: (id) => invoke<ServerMember[]>('server_members', c('server_members', { id })),
			membersPage: (id, params) =>
				invoke<PageServerMember>(
					'server_members_page',
					c('server_members_page', { id, params: params ?? {} })
				),
			voiceStates: (id) =>
				invoke<Record<string, unknown>>(
					'server_voice_states',
					c('server_voice_states', { id })
				),
			createChannel: (id, data) =>
				invoke<Channel>('server_create_channel', c('server_create_channel', { id, data })),
			kickMember: (serverId, userId, opts) =>
				invoke<SuccessResponse>(
					'member_kick',
					c('member_kick', { serverId, userId, deleteSeconds: opts?.delete_seconds })
				),
			banMember: (serverId, body) =>
				invoke<ServerBan>('member_ban', c('member_ban', { serverId, body })),
			unbanMember: (serverId, userId) =>
				invoke<SuccessResponse>('member_unban', c('member_unban', { serverId, userId })),
			listBans: (serverId, params) =>
				invoke<PageServerBan>(
					'list_bans',
					c('list_bans', { serverId, params: params ?? {} })
				),
			memberMessages: (serverId, userId, params) =>
				invoke<PageMemberMessageEntry>(
					'member_messages',
					c('member_messages', { serverId, userId, params: params ?? {} })
				),
			memberMessageStats: (serverId, userId) =>
				invoke<MemberMessageStats>(
					'member_message_stats',
					c('member_message_stats', { serverId, userId })
				),
			purgeMemberMessages: (serverId, userId, body) =>
				invoke<SuccessResponse>(
					'purge_member_messages',
					c('purge_member_messages', { serverId, userId, body })
				),
			memberBanHistory: (serverId, userId) =>
				invoke<ServerBan[]>(
					'member_ban_history',
					c('member_ban_history', { serverId, userId })
				),
			auditLog: (serverId, params) =>
				invoke<PageAuditLog>(
					'audit_log',
					c('audit_log', { serverId, params: params ?? {} })
				),
			memberAuditLog: (serverId, userId, params) =>
				invoke<PageAuditLog>(
					'member_audit_log',
					c('member_audit_log', { serverId, userId, params: params ?? {} })
				),
			createInvite: (serverId, data) =>
				invoke<CreateInviteResponse>(
					'invites_create',
					c('invites_create', { serverId, data: data ?? {} })
				),
			listInvites: (serverId, params) =>
				invoke<PageServerInvite>(
					'invites_list',
					c('invites_list', { serverId, params: params ?? {} })
				),
			deleteInvite: (serverId, code) =>
				invoke<SuccessResponse>('invite_delete', c('invite_delete', { serverId, code })),
			updateInvite: (serverId, code, data) =>
				invoke<ServerInvite>('update_invite', c('update_invite', { serverId, code, data })),
			trashChannels: (id) =>
				invoke<TrashChannelEntry[]>('trash_channels', c('trash_channels', { serverId: id })),
			trashRoles: (id) =>
				invoke<TrashRoleEntry[]>('trash_roles', c('trash_roles', { serverId: id })),
			trashMessages: (id, params) =>
				invoke<PageTrashMessageEntry>(
					'trash_messages',
					c('trash_messages', { serverId: id, params: params ?? {} })
				)
		},
		invites: {
			preview: (code) => invoke<InvitePreview>('invite_preview', c('invite_preview', { code })),
			join: (code) => invoke<InviteJoinResponse>('invite_join', c('invite_join', { code }))
		},
		roles: {
			list: (serverId) => invoke<ServerRole[]>('roles_list', c('roles_list', { serverId })),
			create: (serverId, data) =>
				invoke<ServerRole>('role_create', c('role_create', { serverId, data })),
			update: (roleId, data) =>
				invoke<ServerRole>('role_update', c('role_update', { roleId, data })),
			delete: (roleId) => invoke<SuccessResponse>('role_delete', c('role_delete', { roleId })),
			swap: (a, b) =>
				invoke<SuccessResponse>('role_swap', c('role_swap', { roleId: a, otherRoleId: b })),
			reorder: (serverId, roleIds) =>
				invoke<SuccessResponse>('role_reorder', c('role_reorder', { serverId, roleIds })),
			assign: (serverId, userId, roleId) =>
				invoke<SuccessResponse>('role_assign', c('role_assign', { serverId, userId, roleId })),
			unassign: (serverId, userId, roleId) =>
				invoke<SuccessResponse>(
					'role_unassign',
					c('role_unassign', { serverId, userId, roleId })
				),
			myPermissions: (serverId) =>
				invoke<MyPermissions>('my_permissions', c('my_permissions', { serverId })),
			permissionTree: (serverId, userId) =>
				invoke<PermissionTree>(
					'role_permission_tree',
					c('role_permission_tree', { serverId, userId })
				),
			memberPermissions: (serverId, userId) =>
				invoke<MemberPermissionsView>(
					'role_member_permissions',
					c('role_member_permissions', { serverId, userId })
				),
			restore: (roleId) => invoke<ServerRole>('role_restore', c('role_restore', { roleId })),
			hardDelete: (roleId) =>
				invoke<SuccessResponse>('role_hard_delete', c('role_hard_delete', { roleId }))
		},
		channels: {
			messages: (id, opts) =>
				invoke<Message[]>(
					'channel_messages',
					c('channel_messages', {
						id,
						before: opts?.before,
						limit: opts?.limit,
						includeDeleted: opts?.include_deleted
					})
				),
			send: (id, data) => invoke<Message>('channel_send', c('channel_send', { id, body: data })),
			editMessage: (channelId, messageId, content) =>
				invoke<Message>(
					'channel_edit_message',
					c('channel_edit_message', { channelId, messageId, content })
				),
			deleteMessage: (channelId, messageId) =>
				invoke<SuccessResponse>(
					'channel_delete_message',
					c('channel_delete_message', { channelId, messageId })
				),
			clearEmbeds: (channelId, messageId) =>
				invoke<Message>(
					'channel_clear_embeds',
					c('channel_clear_embeds', { channelId, messageId })
				),
			addReaction: (channelId, messageId, kind, value) =>
				invoke<Message>(
					'channel_add_reaction',
					c('channel_add_reaction', { channelId, messageId, kind, value })
				),
			pins: (id, opts) =>
				invoke<Message[]>(
					'channel_pins',
					c('channel_pins', { id, includeDeleted: opts?.include_deleted })
				),
			pin: (channelId, messageId) =>
				invoke<SuccessResponse>('channel_pin', c('channel_pin', { channelId, messageId })),
			unpin: (channelId, messageId) =>
				invoke<SuccessResponse>('channel_unpin', c('channel_unpin', { channelId, messageId })),
			typing: (id) => invoke<SuccessResponse>('channel_typing', c('channel_typing', { id })),
			update: (id, data) =>
				invoke<Channel>('channel_update', c('channel_update', { id, data })),
			delete: (id) => invoke<SuccessResponse>('channel_delete', c('channel_delete', { id })),
			restore: (id) => invoke<Channel>('channel_restore', c('channel_restore', { id })),
			hardDelete: (id) =>
				invoke<SuccessResponse>('channel_hard_delete', c('channel_hard_delete', { id })),
			restoreMessage: (channelId, messageId) =>
				invoke<Message>(
					'channel_restore_message',
					c('channel_restore_message', { channelId, messageId })
				),
			hardDeleteMessage: (channelId, messageId) =>
				invoke<SuccessResponse>(
					'channel_hard_delete_message',
					c('channel_hard_delete_message', { channelId, messageId })
				),
			reorder: (serverId, body) =>
				invoke<SuccessResponse>('channel_reorder', c('channel_reorder', { serverId, body }))
		},
		uploads: {
			presign: (data) =>
				invoke<UploadPresignResponse>('upload_presign', c('upload_presign', { body: data })),
			finalize: (uploadId, data) =>
				invoke<UploadFinalizeResponse>(
					'upload_finalize',
					c('upload_finalize', { uploadId, body: data })
				)
		},
		users: {
			me: () => invoke<User>('users_me', c('users_me')),
			resolve: (q) => invoke<UserResolveResult>('users_resolve', c('users_resolve', { q })),
			updateMe: (data) => invoke<User>('users_update_me', c('users_update_me', { data })),
			dmChannels: () => invoke<DmChannelSummary[]>('dm_channels', c('dm_channels')),
			createDM: (recipientId, syrInstanceUrl) =>
				invoke<CreateDmResponse>(
					'create_dm',
					c('create_dm', { recipientId, syrInstanceUrl })
				)
		},
		relations: {
			snapshot: () =>
				invoke<RelationsSnapshot>('relations_snapshot', c('relations_snapshot')),
			listFriends: (params) =>
				invoke<PageFriendshipRow>(
					'list_friends',
					c('list_friends', { params: (params as object) ?? {} })
				),
			listBlocked: (params) =>
				invoke<PageBlockedRow>(
					'list_blocked',
					c('list_blocked', { params: (params as object) ?? {} })
				),
			listIgnored: (params) =>
				invoke<PageIgnoredRow>(
					'list_ignored',
					c('list_ignored', { params: (params as object) ?? {} })
				),
			sendRequest: (userId, syrInstanceUrl) =>
				invoke<Friendship>('friend_send', c('friend_send', { userId, syrInstanceUrl })),
			accept: (userId) => invoke<Friendship>('friend_accept', c('friend_accept', { userId })),
			decline: (userId) =>
				invoke<SuccessResponse>('friend_decline', c('friend_decline', { userId })),
			cancelOrRemove: (userId) =>
				invoke<SuccessResponse>('friend_remove', c('friend_remove', { userId })),
			block: (userId) => invoke<SuccessResponse>('block', c('block', { userId })),
			unblock: (userId) => invoke<SuccessResponse>('unblock', c('unblock', { userId })),
			ignore: (userId) => invoke<SuccessResponse>('ignore', c('ignore', { userId })),
			unignore: (userId) => invoke<SuccessResponse>('unignore', c('unignore', { userId }))
		},
		voice: {
			token: (channelId) =>
				invoke<VoiceTokenResponse>('voice_token', c('voice_token', { channelId }))
		},
		categories: {
			list: (serverId) =>
				invoke<ChannelCategory[]>('categories_list', c('categories_list', { serverId })),
			create: (serverId, data) =>
				invoke<ChannelCategory>(
					'category_create',
					c('category_create', { serverId, name: data.name })
				),
			update: (categoryId, data) =>
				invoke<ChannelCategory>('category_update', c('category_update', { categoryId, data })),
			delete: (categoryId) =>
				invoke<SuccessResponse>('category_delete', c('category_delete', { categoryId })),
			swap: (a, b) => invoke<SuccessResponse>('category_swap', c('category_swap', { a, b })),
			reorder: (serverId, categoryIds) =>
				invoke<SuccessResponse>(
					'category_reorder',
					c('category_reorder', { serverId, categoryIds })
				)
		},
		overrides: {
			list: (serverId) =>
				invoke<PermissionOverride[]>('overrides_list', c('overrides_list', { serverId })),
			forChannel: (serverId, channelId) =>
				invoke<PermissionOverride[]>(
					'overrides_for_channel',
					c('overrides_for_channel', { serverId, channelId })
				),
			forCategory: (serverId, categoryId) =>
				invoke<PermissionOverride[]>(
					'overrides_for_category',
					c('overrides_for_category', { serverId, categoryId })
				),
			upsert: (serverId, data) =>
				invoke<PermissionOverride>(
					'override_upsert',
					c('override_upsert', { serverId, body: data })
				),
			delete: (serverId, overrideId) =>
				invoke<SuccessResponse>(
					'override_delete',
					c('override_delete', { serverId, overrideId })
				)
		},
		dispose: () => {
			/* nothing to free on the JS side; Rust state is process-scoped */
		}
	};
}
