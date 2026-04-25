import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';

/**
 * Per-channel unread count + mention tracking.
 */

interface UnreadState {
	count: number;
	mentionCount: number;
}

const unreadMap = new Map<string, UnreadState>();
let version = $state(0);

export function getUnread(channelId: string): UnreadState {
	void version; // subscribe to changes
	return unreadMap.get(channelId) || { count: 0, mentionCount: 0 };
}

export function getServerUnread(channelIds: string[]): { count: number; mentions: number } {
	void version;
	let count = 0;
	let mentions = 0;
	for (const id of channelIds) {
		const state = unreadMap.get(id);
		if (state) {
			count += state.count;
			mentions += state.mentionCount;
		}
	}
	return { count, mentions };
}

export function markRead(channelId: string) {
	unreadMap.set(channelId, { count: 0, mentionCount: 0 });
	version++;
}

export function setUnreadData(data: { channel_id: string; count: number; mention_count: number }[]) {
	for (const entry of data) {
		unreadMap.set(entry.channel_id, { count: entry.count, mentionCount: entry.mention_count });
	}
	version++;
}

// Active channel tracking — messages in the active channel don't increment unread
let activeChannelId: string | null = null;

export function setActiveChannelForUnread(channelId: string | null) {
	activeChannelId = channelId;
	if (channelId) markRead(channelId);
}

// Listen for new messages → increment unread if not in active channel
onWsEvent(WsOp.MESSAGE_CREATE, (data) => {
	const msg = data as { channel_id: string; content?: string };
	if (msg.channel_id === activeChannelId) return; // user is viewing this channel

	const current = unreadMap.get(msg.channel_id) || { count: 0, mentionCount: 0 };
	current.count++;

	// Basic mention detection: check for @handle patterns
	// TODO: match against current user's handle
	unreadMap.set(msg.channel_id, current);
	version++;
});

// READY event provides initial unread state
onWsEvent(WsOp.READY, (data) => {
	const d = data as { unread?: { channel_id: string; count: number; mention_count: number }[] };
	if (d.unread) {
		setUnreadData(d.unread);
	}
});
