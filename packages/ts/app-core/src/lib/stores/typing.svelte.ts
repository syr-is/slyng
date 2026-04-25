import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';

/**
 * Per-channel typing indicators.
 *
 * Auto-clear runs slightly longer than the sender's heartbeat (~2 s) so that
 * as long as someone is actively typing, the indicator stays lit. When they
 * stop typing or send the message, the indicator disappears within ~3 s.
 */

const AUTO_CLEAR_MS = 3500;

const typingUsers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
let currentTyping = $state<string[]>([]);
let currentChannelId: string | null = null;

export function getTyping() {
	return {
		get users() {
			return currentTyping;
		}
	};
}

export function setTypingChannel(channelId: string) {
	currentChannelId = channelId;
	updateCurrentTyping();
}

function updateCurrentTyping() {
	if (!currentChannelId) {
		currentTyping = [];
		return;
	}
	const users = typingUsers.get(currentChannelId);
	currentTyping = users ? [...users.keys()] : [];
}

function clearUser(channelId: string, userId: string) {
	const channelTypers = typingUsers.get(channelId);
	if (!channelTypers) return;
	const existing = channelTypers.get(userId);
	if (existing) clearTimeout(existing);
	channelTypers.delete(userId);
	if (channelTypers.size === 0) typingUsers.delete(channelId);
	updateCurrentTyping();
}

onWsEvent(WsOp.TYPING_START_BROADCAST, (data) => {
	const { channel_id, user_id } = data as { channel_id: string; user_id: string };

	let channelTypers = typingUsers.get(channel_id);
	if (!channelTypers) {
		channelTypers = new Map();
		typingUsers.set(channel_id, channelTypers);
	}

	// Refresh existing timeout so continuous typers stay lit
	const existing = channelTypers.get(user_id);
	if (existing) clearTimeout(existing);

	channelTypers.set(
		user_id,
		setTimeout(() => clearUser(channel_id, user_id), AUTO_CLEAR_MS)
	);

	updateCurrentTyping();
});

// When a message lands, the sender clearly isn't "still typing" anymore —
// clear their indicator immediately rather than waiting for auto-clear.
onWsEvent(WsOp.MESSAGE_CREATE, (data) => {
	const d = data as { channel_id?: string; sender_id?: string };
	if (d.channel_id && d.sender_id) clearUser(d.channel_id, d.sender_id);
});
