import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from '../stores/ws.svelte';

/**
 * Reactive voice state store.
 *
 * `channelUserMap` is the source of truth for who is connected to which
 * voice channel. It's populated from the server on server load (snapshot
 * via /servers/:id/voice-states) and kept in sync by VOICE_STATE_UPDATE_BROADCAST
 * events. Because all server-members subscribe to every channel on server
 * enter, every member receives the join/leave/state events for the whole
 * server — so the list stays live for everyone, not just the viewer of the
 * channel they happen to be in.
 */

export interface ChannelUser {
	user_id: string;
	self_mute: boolean;
	self_deaf: boolean;
	has_camera: boolean;
	has_screen: boolean;
}

let currentChannelId = $state<string | null>(null);
let selfMute = $state(false);
let selfDeaf = $state(false);

const channelUserMap = new SvelteMap<string, ChannelUser[]>();

export function getVoiceState() {
	return {
		get channelId() { return currentChannelId; },
		get selfMute() { return selfMute; },
		get selfDeaf() { return selfDeaf; },
		/** Users in the channel the local client is currently connected to. */
		get users(): ChannelUser[] {
			return currentChannelId ? channelUserMap.get(currentChannelId) ?? [] : [];
		},
		get inVoice() { return currentChannelId !== null; }
	};
}

export function getChannelUsersFor(channelId: string): ChannelUser[] {
	return channelUserMap.get(channelId) ?? [];
}

/** Replace the user list for a channel. Used by the initial server snapshot. */
export function setChannelUsers(channelId: string, users: ChannelUser[]) {
	channelUserMap.set(channelId, users);
}

/** Drop all cached channel user lists (e.g. switching servers). */
export function clearChannelUsers() {
	channelUserMap.clear();
}

export function setVoiceChannel(channelId: string | null) {
	currentChannelId = channelId;
}

/** Add local user to a channel's user list (server broadcast excludes sender). */
export function addLocalUserToChannel(channelId: string, userId: string) {
	upsertUserInChannel(channelId, {
		user_id: userId,
		self_mute: selfMute,
		self_deaf: selfDeaf,
		has_camera: false,
		has_screen: false
	});
}

/** Remove local user from all channel user lists on leave. */
export function removeLocalUser(userId: string) {
	removeUserFromAllChannels(userId);
}

export function setSelfMute(muted: boolean) {
	selfMute = muted;
}

export function setSelfDeaf(deafened: boolean) {
	selfDeaf = deafened;
}

function upsertUserInChannel(channelId: string, user: ChannelUser) {
	const existing = channelUserMap.get(channelId) ?? [];
	const filtered = existing.filter((u) => u.user_id !== user.user_id);
	channelUserMap.set(channelId, [...filtered, user]);
}

function removeUserFromAllChannels(userId: string) {
	for (const [chId, users] of channelUserMap) {
		const filtered = users.filter((u) => u.user_id !== userId);
		if (filtered.length !== users.length) {
			channelUserMap.set(chId, filtered);
		}
	}
}

// ── WS listener ──

onWsEvent(WsOp.VOICE_STATE_UPDATE_BROADCAST, (data: unknown) => {
	const d = data as {
		action: string;
		user_id?: string;
		channel_id?: string | null;
		users?: ChannelUser[];
		self_mute?: boolean;
		self_deaf?: boolean;
	};

	if (d.action === 'channel_users' && d.channel_id && d.users) {
		channelUserMap.set(d.channel_id, d.users);
		return;
	}

	if (d.action === 'join' && d.user_id && d.channel_id) {
		removeUserFromAllChannels(d.user_id);
		upsertUserInChannel(d.channel_id, {
			user_id: d.user_id,
			self_mute: d.self_mute ?? false,
			self_deaf: d.self_deaf ?? false,
			has_camera: (d as any).has_camera ?? false,
			has_screen: (d as any).has_screen ?? false
		});
		return;
	}

	if (d.action === 'state_update' && d.user_id && d.channel_id) {
		upsertUserInChannel(d.channel_id, {
			user_id: d.user_id,
			self_mute: d.self_mute ?? false,
			self_deaf: d.self_deaf ?? false,
			has_camera: (d as any).has_camera ?? false,
			has_screen: (d as any).has_screen ?? false
		});
		return;
	}

	if (d.action === 'leave' && d.user_id) {
		removeUserFromAllChannels(d.user_id);
		return;
	}
});
