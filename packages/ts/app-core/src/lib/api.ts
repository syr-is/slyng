/**
 * Client-side API helper for the syren NestJS backend.
 *
 * Base URL is resolved at request-time via `apiUrl()` so the same client
 * works both in same-origin web (via dev proxy / reverse proxy) and in the
 * Tauri native app (absolute URL pointing at user-configured host).
 */

import { apiUrl, getApiTransport } from './host';

function toQuery(params: Record<string, unknown>): string {
	const usp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		usp.set(k, String(v));
	}
	const q = usp.toString();
	return q ? `?${q}` : '';
}

/**
 * Single chokepoint for every API call. Default behaviour is `fetch`
 * with cookies (the web flow). When a transport has been registered
 * via `setApiTransport()` (the Tauri native shell does this at boot),
 * every call routes through that instead — Tauri → Rust →
 * `syren-client` → reqwest with the persistent cookie jar. Same JS
 * surface, different underlying wire; no auth state in JS at all.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const transport = getApiTransport();
	if (transport) {
		const body = options.body
			? typeof options.body === 'string'
				? JSON.parse(options.body)
				: (options.body as unknown)
			: undefined;
		return transport<T>(path, { method: options.method ?? 'GET', body });
	}

	const response = await fetch(apiUrl(path), {
		credentials: 'include',
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options.headers
		}
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({ message: response.statusText }));
		throw new Error(error.message || `Request failed: ${response.status}`);
	}
	return response.json();
}

// ── Servers ──

export const api = {
	auth: {
		me: () =>
			request<{
				did: string;
				syr_instance_url: string;
				delegate_public_key?: string;
			}>('/auth/me'),
		login: (instance_url: string, redirect?: string) =>
			request<{ consent_url: string }>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ instance_url, redirect })
			}),
		logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
		exchange: (code: string) =>
			request<{ session: string }>('/auth/exchange', {
				method: 'POST',
				body: JSON.stringify({ code })
			})
	},
	servers: {
		list: () => request<unknown[]>('/servers/@me'),
		create: (data: {
			name: string;
			icon_url?: string;
			banner_url?: string;
			invite_background_url?: string;
			description?: string;
		}) => request('/servers', { method: 'POST', body: JSON.stringify(data) }),
		get: (id: string) => request(`/servers/${encodeURIComponent(id)}`),
		update: (
			id: string,
			data: {
				name?: string;
				description?: string;
				icon_url?: string | null;
				banner_url?: string | null;
				invite_background_url?: string | null;
			}
		) => request(`/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
		delete: (id: string) =>
			request(`/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
		leave: (id: string) =>
			request<{ success: boolean }>(
				`/servers/${encodeURIComponent(id)}/members/@me`,
				{ method: 'DELETE' }
			),
		transferOwnership: (id: string, newOwnerId: string) =>
			request<{ server: unknown; former_owner_role_id: string }>(
				`/servers/${encodeURIComponent(id)}/transfer-ownership`,
				{ method: 'POST', body: JSON.stringify({ new_owner_id: newOwnerId }) }
			),
		channels: (id: string) => request<unknown[]>(`/servers/${encodeURIComponent(id)}/channels`),
		members: (id: string) => request<unknown[]>(`/servers/${encodeURIComponent(id)}/members`),
		membersPage: (
			id: string,
			params: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
		) =>
			request<{ items: any[]; total: number }>(
				`/servers/${encodeURIComponent(id)}/members${toQuery(params)}`
			),
		voiceStates: (id: string) =>
			request<
				Record<
					string,
					{
						user_id: string;
						channel_id: string;
						server_id: string;
						self_mute: boolean;
						self_deaf: boolean;
						has_camera?: boolean;
						has_screen?: boolean;
					}[]
				>
			>(`/servers/${encodeURIComponent(id)}/voice-states`),
		kickMember: (serverId: string, userId: string, opts: { delete_seconds?: number } = {}) =>
			request(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}${toQuery(opts)}`,
				{ method: 'DELETE' }
			),
		banMember: (
			serverId: string,
			data: { user_id: string; reason?: string; delete_seconds?: number }
		) =>
			request(`/servers/${encodeURIComponent(serverId)}/bans`, {
				method: 'POST',
				body: JSON.stringify(data)
			}),
		unbanMember: (serverId: string, userId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/bans/${encodeURIComponent(userId)}`, {
				method: 'DELETE'
			}),
		listBans: (
			serverId: string,
			params: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
		) =>
			request<{
				items: Array<{
					id?: string;
					server_id: string;
					user_id: string;
					syr_instance_url?: string;
					banned_by: string;
					banned_at: string;
					reason: string | null;
					active?: boolean;
					unbanned_at?: string | null;
					unbanned_by?: string | null;
				}>;
				total: number;
			}>(`/servers/${encodeURIComponent(serverId)}/bans${toQuery(params)}`),
		memberMessages: (
			serverId: string,
			userId: string,
			params: { limit?: number; offset?: number; before?: string; q?: string } = {}
		) =>
			request<{
				items: Array<{
					id: string;
					channel_id: string;
					channel_name: string | null;
					sender_id: string;
					content: string;
					created_at: string;
					edited_at?: string;
					attachments?: any[];
				}>;
				total: number;
			}>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/messages${toQuery(params)}`
			),
		memberMessageStats: (serverId: string, userId: string) =>
			request<{
				total: number;
				first_at: string | null;
				last_at: string | null;
				per_channel: Array<{ channel_id: string; channel_name: string | null; count: number }>;
			}>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/message-stats`
			),
		purgeMemberMessages: (serverId: string, userId: string, data: { delete_seconds: number }) =>
			request<{ success: boolean }>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/purge`,
				{ method: 'POST', body: JSON.stringify(data) }
			),
		memberBanHistory: (serverId: string, userId: string) =>
			request<
				Array<{
					id?: string;
					banned_by: string;
					banned_at: string;
					reason: string | null;
					active: boolean;
					unbanned_at?: string | null;
					unbanned_by?: string | null;
				}>
			>(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/ban-history`),
		auditLog: (
			serverId: string,
			params: {
				limit?: number;
				offset?: number;
				action?: string;
				actor_id?: string;
				target_user_id?: string;
				channel_id?: string;
				since?: string;
				until?: string;
				q?: string;
			} = {}
		) =>
			request<{
				items: Array<{
					id?: string;
					server_id: string;
					actor_id: string;
					action: string;
					target_kind: string;
					target_id: string | null;
					target_user_id: string | null;
					channel_id: string | null;
					metadata: Record<string, unknown>;
					reason: string | null;
					batch_id: string | null;
					created_at: string;
				}>;
				total: number;
			}>(`/servers/${encodeURIComponent(serverId)}/audit-log${toQuery(params)}`),
		memberAuditLog: (
			serverId: string,
			userId: string,
			params: { limit?: number; offset?: number; action?: string; q?: string } = {}
		) =>
			request<{
				items: Array<{
					id?: string;
					actor_id: string;
					action: string;
					target_kind: string;
					target_id: string | null;
					target_user_id: string | null;
					metadata: Record<string, unknown>;
					reason: string | null;
					batch_id: string | null;
					created_at: string;
				}>;
				total: number;
			}>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/audit-log${toQuery(params)}`
			),
		createInvite: (
			id: string,
			data?: {
				max_uses?: number;
				expires_in?: number;
				target_kind?: 'open' | 'instance' | 'did';
				target_value?: string;
				label?: string;
			}
		) =>
			request<{ code: string }>(`/servers/${encodeURIComponent(id)}/invites`, {
				method: 'POST',
				body: JSON.stringify(data || {})
			}),
		listInvites: (
			id: string,
			params: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string } = {}
		) =>
			request<{
				items: Array<{
					id?: string;
					code: string;
					created_by: string;
					created_at: string;
					expires_at: string | null;
					max_uses: number;
					uses: number;
					target_kind: 'open' | 'instance' | 'did';
					target_value: string | null;
					label: string | null;
				}>;
				total: number;
			}>(`/servers/${encodeURIComponent(id)}/invites${toQuery(params)}`),
		deleteInvite: (id: string, code: string) =>
			request<{ success: true }>(
				`/servers/${encodeURIComponent(id)}/invites/${encodeURIComponent(code)}`,
				{ method: 'DELETE' }
			),
		updateInvite: (id: string, code: string, data: { label?: string | null }) =>
			request(
				`/servers/${encodeURIComponent(id)}/invites/${encodeURIComponent(code)}`,
				{ method: 'PATCH', body: JSON.stringify(data) }
			),
		createChannel: (id: string, data: { name: string; type?: string; category_id?: string }) =>
			request(`/servers/${encodeURIComponent(id)}/channels`, { method: 'POST', body: JSON.stringify(data) }),
		trashChannels: (id: string) =>
			request<
				Array<{
					id: string;
					name: string;
					type: string;
					deleted_at: string;
					deleted_by: string;
					message_count: number;
				}>
			>(`/servers/${encodeURIComponent(id)}/trash/channels`),
		trashRoles: (id: string) =>
			request<
				Array<{
					id: string;
					name: string;
					color: string | null;
					deleted_at: string;
					deleted_by: string;
					member_count: number;
				}>
			>(`/servers/${encodeURIComponent(id)}/trash/roles`),
		trashMessages: (
			id: string,
			params: {
				limit?: number;
				offset?: number;
				q?: string;
				before?: string;
				sender_id?: string;
				deleted_by?: string;
				since?: string;
				until?: string;
			} = {}
		) =>
			request<{
				items: Array<{
					id: string;
					channel_id: string;
					channel_name: string | null;
					sender_id: string;
					sender_instance_url?: string;
					content: string;
					attachments?: any[];
					created_at: string;
					deleted_at: string;
					deleted_by: string;
				}>;
				total: number;
			}>(`/servers/${encodeURIComponent(id)}/trash/messages${toQuery(params)}`)
	},

	invites: {
		preview: (code: string) =>
			request<{
				code: string;
				server: {
					id: string;
					name: string;
					icon_url: string | null;
					banner_url: string | null;
					invite_background_url: string | null;
					description: string | null;
					member_count: number;
				};
			}>(`/invites/${code}`),
		join: (code: string) =>
			request<{ server_id: string }>(`/invites/${code}`, { method: 'POST' })
	},

	roles: {
		list: (serverId: string) =>
			request<unknown[]>(`/servers/${encodeURIComponent(serverId)}/roles`),
		create: (
			serverId: string,
			data: {
				name: string;
				color?: string | null;
				permissions?: string;
				permissions_allow?: string;
				permissions_deny?: string;
			}
		) =>
			request(`/servers/${encodeURIComponent(serverId)}/roles`, { method: 'POST', body: JSON.stringify(data) }),
		update: (
			roleId: string,
			data: {
				name?: string;
				color?: string | null;
				permissions?: string;
				permissions_allow?: string;
				permissions_deny?: string;
				position?: number;
			}
		) =>
			request(`/roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body: JSON.stringify(data) }),
		delete: (roleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }),
		swap: (roleId: string, otherRoleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}/swap/${encodeURIComponent(otherRoleId)}`, { method: 'POST' }),
		reorder: (serverId: string, roleIds: string[]) =>
			request(`/servers/${encodeURIComponent(serverId)}/roles/reorder`, {
				method: 'POST',
				body: JSON.stringify({ roleIds })
			}),
		assign: (serverId: string, userId: string, roleId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: 'POST' }),
		unassign: (serverId: string, userId: string, roleId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }),
		myPermissions: (serverId: string) =>
			request<{
				permissions: string;
				permissions_allow: string;
				permissions_deny: string;
				highest_role_position: number;
				is_owner: boolean;
			}>(`/servers/${encodeURIComponent(serverId)}/members/@me/permissions`),
		permissionTree: (serverId: string, userId: string) =>
			request<{
				server: { permissions: string };
				categories: Array<{
					id: string; name: string; position: number; permissions: string;
					channels: Array<{
						id: string; name: string; type: string; position: number;
						permissions: string; can_view: boolean;
					}>;
				}>;
				uncategorized: Array<{
					id: string; name: string; type: string; position: number;
					permissions: string; can_view: boolean;
				}>;
			}>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/permission-tree`
			),
		memberPermissions: (serverId: string, userId: string) =>
			request<{
				permissions: string;
				permissions_allow: string;
				permissions_deny: string;
				highest_role_position: number;
				is_owner: boolean;
				visible_channels: Array<{ id: string; name: string; type: string }>;
			}>(
				`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/permissions`
			),
		restore: (roleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}/restore`, { method: 'POST' }),
		hardDelete: (roleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}/hard`, { method: 'DELETE' })
	},

	channels: {
		messages: (
			id: string,
			options?: { before?: string; limit?: number; include_deleted?: boolean }
		) => {
			const params = new URLSearchParams();
			if (options?.before) params.set('before', options.before);
			if (options?.limit) params.set('limit', String(options.limit));
			if (options?.include_deleted) params.set('include_deleted', 'true');
			const qs = params.toString();
			return request<unknown[]>(`/channels/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ''}`);
		},
		send: (
			id: string,
			data: {
				content: string;
				reply_to?: string[];
				attachments?: Array<{
					url: string;
					filename: string;
					mime_type: string;
					size: number;
					width?: number;
					height?: number;
				}>;
			}
		) =>
			request(`/channels/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(data) }),
		editMessage: (channelId: string, messageId: string, content: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
				method: 'PATCH',
				body: JSON.stringify({ content })
			}),
		deleteMessage: (channelId: string, messageId: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }),
		clearEmbeds: (channelId: string, messageId: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/embeds`, { method: 'DELETE' }),
		addReaction: (channelId: string, messageId: string, kind: string, value: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
				method: 'POST',
				body: JSON.stringify({ kind, value })
			}),
		pins: (id: string, options?: { include_deleted?: boolean }) =>
			request<unknown[]>(
				`/channels/${encodeURIComponent(id)}/pins${options?.include_deleted ? '?include_deleted=true' : ''}`
			),
		pin: (channelId: string, messageId: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/pins`, {
				method: 'POST',
				body: JSON.stringify({ message_id: messageId })
			}),
		unpin: (channelId: string, messageId: string) =>
			request(`/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`, {
				method: 'DELETE'
			}),
		typing: (id: string) => request(`/channels/${encodeURIComponent(id)}/typing`, { method: 'POST' }),
		update: (id: string, data: { name?: string; topic?: string; category_id?: string | null }) =>
			request(`/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
		delete: (id: string) =>
			request(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
		restore: (id: string) =>
			request(`/channels/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
		hardDelete: (id: string) =>
			request(`/channels/${encodeURIComponent(id)}/hard`, { method: 'DELETE' }),
		reorder: (serverId: string, channelIds: string[], categoryId?: string | null) =>
			request(`/servers/${encodeURIComponent(serverId)}/channels/reorder`, {
				method: 'POST',
				body: JSON.stringify({ channelIds, categoryId })
			}),
		restoreMessage: (channelId: string, messageId: string) =>
			request(
				`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/restore`,
				{ method: 'POST' }
			),
		hardDeleteMessage: (channelId: string, messageId: string) =>
			request(
				`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/hard`,
				{ method: 'DELETE' }
			)
	},

	uploads: {
		presign: (data: { filename: string; mime_type: string; size: number; channel_id?: string; sha256?: string }) =>
			request<{ upload_id: string; signed_url: string; final_url: string; max_bytes: number }>(
				'/uploads/presign',
				{ method: 'POST', body: JSON.stringify(data) }
			),
		finalize: (uploadId: string, data: { sha256?: string; width?: number; height?: number }) =>
			request<{
				url: string;
				filename: string;
				mime_type: string;
				size: number;
				width?: number;
				height?: number;
			}>(`/uploads/${encodeURIComponent(uploadId)}/finalize`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			})
	},

	users: {
		me: () =>
			request<{
				did: string;
				syr_instance_url?: string;
				trusted_domains: string[];
				allow_dms: 'open' | 'friends_only' | 'closed';
				allow_friend_requests: 'open' | 'mutual' | 'closed';
			}>('/users/@me'),
		resolve: (q: string) =>
			request<{ did: string; syr_instance_url: string | null; registered: boolean }>(
				`/users/resolve${toQuery({ q })}`
			),
		updateMe: (data: Record<string, unknown>) =>
			request('/users/@me', { method: 'PATCH', body: JSON.stringify(data) }),
		dmChannels: () =>
			request<
				Array<{
					id: string;
					type: string;
					last_message_at?: string;
					other_user_id: string | null;
					other_user_instance_url?: string | null;
					is_blocked: boolean;
					is_ignored: boolean;
				}>
			>('/users/@me/channels'),
		createDM: (recipientId: string, syrInstanceUrl?: string) =>
			request<{ id: string; type: string }>('/users/@me/channels', {
				method: 'POST',
				body: JSON.stringify({ recipient_id: recipientId, syr_instance_url: syrInstanceUrl })
			})
	},

	relations: {
		snapshot: () =>
			request<{
				friends: string[];
				incoming: Array<{ from: string; created_at: string }>;
				outgoing: Array<{ to: string; created_at: string }>;
				blocked: string[];
				ignored: string[];
				allow_dms: 'open' | 'friends_only' | 'closed';
				allow_friend_requests: 'open' | 'mutual' | 'closed';
				instances: Record<string, string>;
			}>('/users/@me/relations'),
		listFriends: (params: Paginated = {}) =>
			request<{ items: Array<{ user_id: string }>; total: number }>(
				`/users/@me/friends${toQuery(params as Record<string, unknown>)}`
			),
		sendRequest: (userId: string, syrInstanceUrl?: string) =>
			request(`/users/@me/friends`, {
				method: 'POST',
				body: JSON.stringify({ user_id: userId, syr_instance_url: syrInstanceUrl })
			}),
		accept: (userId: string) =>
			request(`/users/@me/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST' }),
		decline: (userId: string) =>
			request(`/users/@me/friends/${encodeURIComponent(userId)}/decline`, { method: 'POST' }),
		cancelOrRemove: (userId: string) =>
			request(`/users/@me/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
		listBlocked: (params: Paginated = {}) =>
			request<{ items: Array<{ blocker_id: string; blocked_id: string; created_at: string }>; total: number }>(
				`/users/@me/blocklist${toQuery(params as Record<string, unknown>)}`
			),
		block: (userId: string) =>
			request('/users/@me/blocklist', {
				method: 'POST',
				body: JSON.stringify({ user_id: userId })
			}),
		unblock: (userId: string) =>
			request(`/users/@me/blocklist/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
		listIgnored: (params: Paginated = {}) =>
			request<{ items: Array<{ user_id: string; ignored_id: string; created_at: string }>; total: number }>(
				`/users/@me/ignorelist${toQuery(params as Record<string, unknown>)}`
			),
		ignore: (userId: string) =>
			request('/users/@me/ignorelist', {
				method: 'POST',
				body: JSON.stringify({ user_id: userId })
			}),
		unignore: (userId: string) =>
			request(`/users/@me/ignorelist/${encodeURIComponent(userId)}`, { method: 'DELETE' })
	},

	voice: {
		token: (channelId: string) =>
			request<{ token: string; url: string }>('/voice/token', {
				method: 'POST',
				body: JSON.stringify({ channel_id: channelId })
			})
	},

	categories: {
		list: (serverId: string) =>
			request<Array<{ id: string; name: string; position: number; server_id: string }>>(
				`/servers/${encodeURIComponent(serverId)}/categories`
			),
		create: (serverId: string, data: { name: string }) =>
			request(`/servers/${encodeURIComponent(serverId)}/categories`, {
				method: 'POST',
				body: JSON.stringify(data)
			}),
		update: (categoryId: string, data: { name?: string }) =>
			request(`/categories/${encodeURIComponent(categoryId)}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			}),
		delete: (categoryId: string) =>
			request(`/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' }),
		swap: (a: string, b: string) =>
			request(`/categories/${encodeURIComponent(a)}/swap/${encodeURIComponent(b)}`, {
				method: 'POST'
			}),
		reorder: (serverId: string, categoryIds: string[]) =>
			request(`/servers/${encodeURIComponent(serverId)}/categories/reorder`, {
				method: 'POST',
				body: JSON.stringify({ categoryIds })
			})
	},

	overrides: {
		list: (serverId: string) =>
			request<unknown[]>(`/servers/${encodeURIComponent(serverId)}/overrides`),
		forChannel: (serverId: string, channelId: string) =>
			request<unknown[]>(
				`/servers/${encodeURIComponent(serverId)}/overrides/channel/${encodeURIComponent(channelId)}`
			),
		forCategory: (serverId: string, categoryId: string) =>
			request<unknown[]>(
				`/servers/${encodeURIComponent(serverId)}/overrides/category/${encodeURIComponent(categoryId)}`
			),
		upsert: (
			serverId: string,
			data: {
				scope_type: 'server' | 'category' | 'channel';
				scope_id: string | null;
				target_type: 'role' | 'user';
				target_id: string;
				allow: string;
				deny: string;
			}
		) =>
			request(`/servers/${encodeURIComponent(serverId)}/overrides`, {
				method: 'PUT',
				body: JSON.stringify(data)
			}),
		delete: (serverId: string, overrideId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/overrides/${encodeURIComponent(overrideId)}`, {
				method: 'DELETE'
			})
	}
};

type Paginated = { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc'; q?: string };
