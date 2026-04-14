import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';

/**
 * Per-channel message cache with real-time updates.
 */

interface Attachment {
	url: string;
	filename: string;
	mime_type: string;
	size: number;
	width?: number;
	height?: number;
}

interface Embed {
	title?: string;
	description?: string;
	url?: string;
	thumbnail_url?: string;
	site_name?: string;
}

interface Reaction {
	value: string;
	count: number;
	me: boolean;
	kind?: string;
	image_url?: string;
}

export interface MessageData {
	id: string;
	channel_id: string;
	sender_id: string;
	sender_instance_url?: string;
	content: string;
	type: string;
	created_at: string;
	edited_at?: string;
	reply_to?: string[] | string;
	pinned?: boolean;
	attachments?: Attachment[];
	embeds?: Embed[];
	reactions?: Reaction[];
	signature?: string;
	signer_did?: string;
	[key: string]: unknown;
}

const channelMessages = new Map<string, MessageData[]>();
let currentChannelId = $state<string | null>(null);
let messages = $state<MessageData[]>([]);

export function getMessages() {
	return {
		get list() {
			return messages;
		},
		get channelId() {
			return currentChannelId;
		},
		/** Look up a message by id in the currently-loaded channel. */
		find(id: string): MessageData | undefined {
			return messages.find((m) => m.id === id);
		}
	};
}

export function setCurrentChannel(channelId: string, initial: MessageData[] = []) {
	currentChannelId = channelId;
	channelMessages.set(channelId, [...initial]);
	messages = channelMessages.get(channelId)!;
}

export function addMessage(msg: MessageData) {
	const channelMsgs = channelMessages.get(msg.channel_id);
	if (!channelMsgs) return;
	// Dedupe — sender adds locally then WS broadcast also fires
	if (channelMsgs.some((m) => m.id === msg.id)) return;
	channelMsgs.push(msg);
	if (msg.channel_id === currentChannelId) {
		messages = [...channelMsgs];
	}
}

// Listen for WS events
onWsEvent(WsOp.MESSAGE_CREATE, (data) => {
	addMessage(data as MessageData);
});

onWsEvent(WsOp.MESSAGE_UPDATE, (data) => {
	const msg = data as MessageData;
	const channelMsgs = channelMessages.get(msg.channel_id);
	if (channelMsgs) {
		const idx = channelMsgs.findIndex((m) => m.id === msg.id);
		if (idx >= 0) {
			channelMsgs[idx] = msg;
			if (msg.channel_id === currentChannelId) {
				messages = [...channelMsgs];
			}
		}
	}
});

onWsEvent(WsOp.MESSAGE_DELETE, (data) => {
	const { id, channel_id } = data as { id: string; channel_id: string };
	const channelMsgs = channelMessages.get(channel_id);
	if (channelMsgs) {
		const idx = channelMsgs.findIndex((m) => m.id === id);
		if (idx >= 0) {
			channelMsgs.splice(idx, 1);
			if (channel_id === currentChannelId) {
				messages = [...channelMsgs];
			}
		}
	}
});

function patchPinned(channelId: string, messageId: string, pinned: boolean) {
	const channelMsgs = channelMessages.get(channelId);
	if (!channelMsgs) return;
	const idx = channelMsgs.findIndex((m) => m.id === messageId);
	if (idx < 0) return;
	channelMsgs[idx] = { ...channelMsgs[idx], pinned };
	if (channelId === currentChannelId) messages = [...channelMsgs];
}

onWsEvent(WsOp.PIN_ADD, (data) => {
	const { message_id, channel_id } = data as { message_id: string; channel_id: string };
	patchPinned(channel_id, message_id, true);
});

onWsEvent(WsOp.PIN_REMOVE, (data) => {
	const { message_id, channel_id } = data as { message_id: string; channel_id: string };
	patchPinned(channel_id, message_id, false);
});
