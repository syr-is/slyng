import { WsOp } from '@syren/types';

/**
 * WebSocket connection store.
 * Auto-reconnect, heartbeat, server auto-identifies from cookie.
 * Sends queued during connect; channel subscriptions remembered for reconnect.
 */

let socket: WebSocket | null = $state(null);
let connected = $state(false);
let reconnectAttempts = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const listeners = new Map<number, Set<(data: unknown) => void>>();
const sendQueue: { op: number; d: unknown }[] = [];
const subscribedChannels = new Set<string>();

export function getWsState() {
	return {
		get connected() {
			return connected;
		}
	};
}

export function connectWs(apiUrl: string) {
	if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

	const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';
	const ws = new WebSocket(wsUrl);
	socket = ws;

	ws.onopen = () => {
		connected = true;
		reconnectAttempts = 0;

		// Re-subscribe to all channels (in case of reconnect)
		if (subscribedChannels.size > 0) {
			rawSend(ws, { op: WsOp.SUBSCRIBE, d: { channel_ids: [...subscribedChannels] } });
		}

		// Flush any queued sends
		while (sendQueue.length > 0) {
			rawSend(ws, sendQueue.shift()!);
		}

		heartbeatInterval = setInterval(() => {
			send({ op: WsOp.HEARTBEAT, d: null });
		}, 45000);
	};

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data as string);
			const handlers = listeners.get(msg.op);
			// Diagnostic — remove once presence flow is verified end-to-end
			console.debug(`[ws] recv op=${msg.op} handlers=${handlers?.size ?? 0}`, msg.d);
			if (handlers) {
				for (const handler of handlers) {
					handler(msg.d);
				}
			}
		} catch (err) {
			console.warn('[ws] invalid message', err);
		}
	};

	ws.onclose = () => {
		connected = false;
		socket = null;
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
			heartbeatInterval = null;
		}

		const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
		reconnectAttempts++;
		setTimeout(() => connectWs(apiUrl), delay);
	};

	ws.onerror = () => {
		ws.close();
	};
}

export function disconnectWs() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
	}
	socket?.close();
	socket = null;
	connected = false;
	subscribedChannels.clear();
	sendQueue.length = 0;
}

// @nestjs/platform-ws routes incoming messages to @SubscribeMessage('message')
// based on a `event` field on the parsed JSON. Wrap our { op, d } payload so
// it actually reaches the handler.
function rawSend(ws: WebSocket, data: { op: number; d: unknown }) {
	ws.send(JSON.stringify({ event: 'message', data }));
}

export function send(data: { op: number; d: unknown }) {
	if (socket?.readyState === WebSocket.OPEN) {
		rawSend(socket, data);
	} else {
		sendQueue.push(data);
	}
}

export function onWsEvent(op: number, handler: (data: unknown) => void): () => void {
	let set = listeners.get(op);
	if (!set) {
		set = new Set();
		listeners.set(op, set);
	}
	set.add(handler);
	return () => {
		set?.delete(handler);
		if (set?.size === 0) listeners.delete(op);
	};
}

export function subscribeChannels(channelIds: string[]) {
	for (const id of channelIds) subscribedChannels.add(id);
	send({ op: WsOp.SUBSCRIBE, d: { channel_ids: channelIds } });
}

export function unsubscribeChannels(channelIds: string[]) {
	for (const id of channelIds) subscribedChannels.delete(id);
	send({ op: WsOp.UNSUBSCRIBE, d: { channel_ids: channelIds } });
}

export function sendTyping(channelId: string) {
	send({ op: WsOp.TYPING_START, d: { channel_id: channelId } });
}
