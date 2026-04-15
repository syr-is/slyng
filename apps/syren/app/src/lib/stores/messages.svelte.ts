import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { getPerms } from './perms.svelte';

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
	deleted?: boolean;
	deleted_at?: string;
	deleted_by?: string;
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
	if (!channelMsgs) return;
	const idx = channelMsgs.findIndex((m) => m.id === msg.id);
	if (idx < 0) return;

	// `deleted: true` is our soft-delete signal. Block 13:
	//   - Non-privileged viewers (no VIEW_REMOVED_MESSAGES): DROP the row
	//     entirely. Their timeline stays seamless, as if the message never
	//     existed. Replies that referenced it fall back to the "Message
	//     deleted" tombstone client-side.
	//   - Privileged viewers: keep the row, patch in whatever the broadcast
	//     carried (mask on the main channel broadcast; full content on the
	//     un-masked emitToUser follow-up that lands a beat later).
	if ((msg as any).deleted) {
		const perms = getPerms();
		if (!perms.canViewRemovedMessages) {
			channelMsgs.splice(idx, 1);
			if (msg.channel_id === currentChannelId) {
				messages = [...channelMsgs];
			}
			return;
		}
		// Privileged path: trust payload content when present (un-masked
		// follow-up) and fall back to masked fields otherwise.
		const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
		const hasAttachments =
			Array.isArray((msg as any).attachments) && (msg as any).attachments.length > 0;
		if (hasContent || hasAttachments) {
			channelMsgs[idx] = { ...channelMsgs[idx], ...msg };
		} else {
			channelMsgs[idx] = {
				...channelMsgs[idx],
				...msg,
				content: channelMsgs[idx].content,
				attachments: channelMsgs[idx].attachments,
				embeds: channelMsgs[idx].embeds,
				reactions: channelMsgs[idx].reactions
			};
		}
	} else {
		channelMsgs[idx] = { ...channelMsgs[idx], ...msg };
	}
	if (msg.channel_id === currentChannelId) {
		messages = [...channelMsgs];
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
