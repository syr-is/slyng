/**
 * Native API client — thin TS shim over Tauri `invoke()`.
 *
 * Mirrors the shape of `@syren/app-core/api` so existing route code
 * can switch with minimal noise. Every method takes the API host as
 * its first argument (passed through to the Rust side, which uses it
 * to construct the underlying `syren-client::Client`).
 */

import { invoke } from '@tauri-apps/api/core';

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

export class NativeClient {
	constructor(private apiHost: string) {}

	updateHost(host: string) {
		this.apiHost = host;
	}

	// ── auth ──
	startLogin(instanceUrl: string) {
		return invoke<LoginResponse>('start_login', {
			apiHost: this.apiHost,
			instanceUrl
		});
	}
	completeLogin(code: string) {
		return invoke<Identity>('complete_login', { code });
	}
	logout() {
		return invoke<void>('logout');
	}
	me() {
		return invoke<Identity>('me', { apiHost: this.apiHost });
	}

	// ── servers ──
	servers = {
		list: () => invoke<unknown[]>('servers_list', { apiHost: this.apiHost }),
		get: (id: string) => invoke<unknown>('server_get', { apiHost: this.apiHost, id }),
		channels: (id: string) =>
			invoke<unknown[]>('server_channels', { apiHost: this.apiHost, id }),
		members: (id: string) =>
			invoke<unknown[]>('server_members', { apiHost: this.apiHost, id })
	};

	// ── channels ──
	channels = {
		messages: (id: string, before?: string, limit?: number) =>
			invoke<unknown[]>('channel_messages', { apiHost: this.apiHost, id, before, limit }),
		send: (id: string, body: unknown) =>
			invoke<unknown>('channel_send', { apiHost: this.apiHost, id, body }),
		typing: (id: string) => invoke<unknown>('channel_typing', { apiHost: this.apiHost, id })
	};

	// ── users ──
	users = {
		me: () => invoke<unknown>('users_me', { apiHost: this.apiHost }),
		dmChannels: () => invoke<unknown[]>('dm_channels', { apiHost: this.apiHost })
	};

	// ── roles ──
	roles = {
		list: (serverId: string) =>
			invoke<unknown[]>('roles_list', { apiHost: this.apiHost, serverId }),
		myPermissions: (serverId: string) =>
			invoke<unknown>('my_permissions', { apiHost: this.apiHost, serverId })
	};

	// ── categories ──
	categories = {
		list: (serverId: string) =>
			invoke<unknown[]>('categories_list', { apiHost: this.apiHost, serverId })
	};

	// ── relations ──
	relations = {
		snapshot: () => invoke<unknown>('relations_snapshot', { apiHost: this.apiHost })
	};

	// ── invites ──
	invites = {
		preview: (code: string) =>
			invoke<unknown>('invite_preview', { apiHost: this.apiHost, code }),
		join: (code: string) => invoke<unknown>('invite_join', { apiHost: this.apiHost, code })
	};
}

let _client: NativeClient | null = null;

/**
 * Returns the shared NativeClient. Caller must have already saved a
 * host via `setStoredHost` before this is invoked. If no host is set
 * we throw — `+layout.ts` is responsible for redirecting to /setup.
 */
export function getNativeClient(host: string): NativeClient {
	if (!_client) {
		_client = new NativeClient(host);
	} else {
		_client.updateHost(host);
	}
	return _client;
}
