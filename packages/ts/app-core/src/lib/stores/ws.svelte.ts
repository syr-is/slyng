import { WsOp } from '@syren/types';
import { getRealtime, type WsState } from '../realtime';

/**
 * WebSocket dispatch layer. The actual wire transport (connect, IDENTIFY,
 * heartbeat, reconnect, subscribe-state) lives in Rust now — see
 * `RealtimeClient` in `packages/rust/syren-client/src/ws/`. This module
 * registers a single `on_frame` callback against the platform's
 * `RealtimeHandle` and routes incoming frames to per-op listeners
 * (`onWsEvent(op, handler)`), preserving the API consumer stores have
 * always used.
 *
 * `setWsTokenProvider` is a back-compat no-op: the Rust client reads
 * the bearer directly from its `SessionStore` (LocalStorage on web,
 * Tauri Store on native), so JS no longer needs to ferry tokens.
 */

let identified = $state(false);
let connected = $state(false);

const listeners = new Map<number, Set<(data: unknown) => void>>();
const subscribedChannels = new Set<string>();
let unsubscribeFrame: (() => void) | null = null;
let unsubscribeState: (() => void) | null = null;

type WsTokenProvider = () => Promise<string | null>;
export function setWsTokenProvider(_provider: WsTokenProvider | null): void {
	// kept for back-compat — Rust client owns token retrieval now.
}

export function getWsState() {
	return {
		get connected() {
			return connected;
		}
	};
}

export function connectWs(_apiUrl?: string): void {
	const rt = getRealtime();
	if (!rt) {
		console.warn('[ws] connectWs called before setRealtime() — skipping');
		return;
	}

	if (!unsubscribeFrame) {
		unsubscribeFrame = rt.onFrame((op, d) => {
			const handlers = listeners.get(op);
			if (import.meta.env.DEV) {
				console.log(`[ws] recv op=${op} handlers=${handlers?.size ?? 0}`, d);
			}
			if (handlers) for (const h of handlers) h(d);
		});
	}
	if (!unsubscribeState) {
		unsubscribeState = rt.onState((state: WsState) => {
			connected = state === 'connected' || state === 'identified';
			identified = state === 'identified';
			if (import.meta.env.DEV) console.log('[ws] state=', state);
		});
	}

	void rt.connect();
}

export function disconnectWs(): void {
	const rt = getRealtime();
	subscribedChannels.clear();
	if (unsubscribeFrame) {
		unsubscribeFrame();
		unsubscribeFrame = null;
	}
	if (unsubscribeState) {
		unsubscribeState();
		unsubscribeState = null;
	}
	if (rt) void rt.disconnect();
	connected = false;
	identified = false;
}

export function send(data: { op: number; d: unknown }): void {
	const rt = getRealtime();
	if (!rt) {
		console.warn('[ws] send before realtime ready', data);
		return;
	}
	void rt.send(data.op, data.d);
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

export function subscribeChannels(channelIds: string[]): void {
	const rt = getRealtime();
	for (const id of channelIds) subscribedChannels.add(id);
	if (rt) void rt.subscribeChannels(channelIds);
}

export function unsubscribeChannels(channelIds: string[]): void {
	const rt = getRealtime();
	for (const id of channelIds) subscribedChannels.delete(id);
	if (rt) void rt.unsubscribeChannels(channelIds);
}

export function sendTyping(channelId: string): void {
	const rt = getRealtime();
	if (rt) void rt.sendTyping(channelId);
}

// Re-export so consumers that import WsOp from this module's old path
// keep working — every existing store does this.
export { WsOp };
