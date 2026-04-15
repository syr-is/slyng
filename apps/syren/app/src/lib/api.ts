/**
 * Client-side API helper for the syren NestJS backend.
 */

const API_BASE = '/api';

function toQuery(params: Record<string, unknown>): string {
	const usp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		usp.set(k, String(v));
	}
	const q = usp.toString();
	return q ? `?${q}` : '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
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
		createChannel: (id: string, data: { name: string; type?: string }) =>
			request(`/servers/${encodeURIComponent(id)}/channels`, { method: 'POST', body: JSON.stringify(data) })
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
		create: (serverId: string, data: { name: string; color?: string | null; permissions?: string }) =>
			request(`/servers/${encodeURIComponent(serverId)}/roles`, { method: 'POST', body: JSON.stringify(data) }),
		update: (roleId: string, data: { name?: string; color?: string | null; permissions?: string; position?: number }) =>
			request(`/roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body: JSON.stringify(data) }),
		delete: (roleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }),
		swap: (roleId: string, otherRoleId: string) =>
			request(`/roles/${encodeURIComponent(roleId)}/swap/${encodeURIComponent(otherRoleId)}`, { method: 'POST' }),
		assign: (serverId: string, userId: string, roleId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: 'POST' }),
		unassign: (serverId: string, userId: string, roleId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }),
		myPermissions: (serverId: string) =>
			request<{ permissions: string }>(`/servers/${encodeURIComponent(serverId)}/members/@me/permissions`)
	},

	channels: {
		messages: (id: string, options?: { before?: string; limit?: number }) => {
			const params = new URLSearchParams();
			if (options?.before) params.set('before', options.before);
			if (options?.limit) params.set('limit', String(options.limit));
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
		pins: (id: string) => request<unknown[]>(`/channels/${encodeURIComponent(id)}/pins`),
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
		update: (id: string, data: { name?: string; topic?: string }) =>
			request(`/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
		delete: (id: string) =>
			request(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' })
	},

	uploads: {
		presign: (data: { filename: string; mime_type: string; size: number; channel_id?: string }) =>
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
		me: () => request('/users/@me'),
		updateMe: (data: Record<string, unknown>) =>
			request('/users/@me', { method: 'PATCH', body: JSON.stringify(data) }),
		dmChannels: () => request<unknown[]>('/users/@me/channels'),
		createDM: (recipientId: string) =>
			request('/users/@me/channels', {
				method: 'POST',
				body: JSON.stringify({ recipient_id: recipientId })
			})
	}
};
