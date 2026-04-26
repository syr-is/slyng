import { WsOp } from '@syren/types';
import { wsOrigin } from '../host';

/**
 * WebSocket connection store.
 * Auto-reconnect, heartbeat, channel subscriptions remembered for reconnect.
 *
 * Auth: same-origin web relies on the `syren_session` cookie, which the
 * NestJS gateway auto-identifies from. The Tauri native shell can't ride
 * cookies (different origin), so it registers a `tokenProvider` via
 * `setWsTokenProvider` — when set, we send an explicit `IDENTIFY` message
 * with the persisted session id immediately after the socket opens.
 *
 * IDENTIFY ordering: `ws.onopen` is `async` and we may have to await the
 * token provider, so the socket can be in the `OPEN` state before IDENTIFY
 * is dispatched. To prevent any concurrent `send(...)` call from leaking
 * an unauthenticated frame ahead of IDENTIFY, we gate `send()` on a
 * separate `identified` flag rather than the socket's `readyState`.
 */

let socket: WebSocket | null = $state(null);
let connected = $state(false);
let identified = $state(false);
let reconnectAttempts = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const listeners = new Map<number, Set<(data: unknown) => void>>();
const sendQueue: { op: number; d: unknown }[] = [];
const subscribedChannels = new Set<string>();

type WsTokenProvider = () => Promise<string | null>;
let tokenProvider: WsTokenProvider | null = null;
export function setWsTokenProvider(provider: WsTokenProvider | null): void {
	tokenProvider = provider;
}

export function getWsState() {
	return {
		get connected() {
			return connected;
		}
	};
}

export function connectWs(_apiUrl?: string) {
	if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

	const wsUrl = wsOrigin() + '/ws';
	if (import.meta.env.DEV) console.log('[ws] connecting tokenProvider=', tokenProvider ? 'set' : 'unset');
	const ws = new WebSocket(wsUrl);
	socket = ws;

	ws.onopen = async () => {
		connected = true;
		reconnectAttempts = 0;

		// Native: explicit IDENTIFY before anything else (no cookies cross
		// the tauri.localhost ↔ app.slyng.gg origin boundary). Web: skip,
		// gateway auto-identifies from the cookie on the upgrade request.
		// Either way, `identified` flips to true *after* IDENTIFY has been
		// written (or immediately on the cookie path) — `send()` queues
		// every other outbound frame until then.
		if (tokenProvider) {
			try {
				const token = await tokenProvider();
				if (token) {
					if (import.meta.env.DEV) console.log('[ws] IDENTIFY sent');
					rawSend(ws, { op: WsOp.IDENTIFY, d: { token } });
				} else {
					console.warn('[ws] tokenProvider returned no token; connection will be unauthenticated');
				}
			} catch (err) {
				console.warn('[ws] tokenProvider threw', err);
			}
		}
		identified = true;

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
			// Default log: op + handler count only (msg.d for `MESSAGE_CREATE`
			// etc. carries plaintext content). Bodies are dev-only.
			if (import.meta.env.DEV) {
				console.log(`[ws] recv op=${msg.op} handlers=${handlers?.size ?? 0}`, msg.d);
			}
			if (handlers) {
				for (const handler of handlers) {
					handler(msg.d);
				}
			}
		} catch (err) {
			console.warn('[ws] invalid message', err);
		}
	};

	ws.onclose = (event) => {
		if (import.meta.env.DEV) console.log('[ws] close code=', event.code, 'wasClean=', event.wasClean);
		connected = false;
		identified = false;
		socket = null;
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
			heartbeatInterval = null;
		}

		const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
		reconnectAttempts++;
		setTimeout(() => connectWs(), delay);
	};

	ws.onerror = (event) => {
		if (import.meta.env.DEV) console.warn('[ws] error', event);
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
	identified = false;
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
	// Gate on `identified` (not socket state) so concurrent send() calls
	// during the `await tokenProvider()` window in onopen can't leak an
	// unauthenticated frame ahead of IDENTIFY.
	if (identified && socket?.readyState === WebSocket.OPEN) {
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
