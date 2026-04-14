/**
 * Client-side API helper for the syren NestJS backend.
 */

const API_BASE = '/api';

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
		voiceStates: (id: string) =>
			request<Record<string, { user_id: string; channel_id: string; server_id: string; self_mute: boolean; self_deaf: boolean }[]>>(
				`/servers/${encodeURIComponent(id)}/voice-states`
			),
		kickMember: (serverId: string, userId: string) =>
			request(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
		createInvite: (id: string, data?: { max_uses?: number; expires_in?: number }) =>
			request<{ code: string }>(`/servers/${encodeURIComponent(id)}/invites`, {
				method: 'POST',
				body: JSON.stringify(data || {})
			}),
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
