/**
 * Realtime (WebSocket) handle. The transport (WASM `Realtime` on web,
 * Tauri commands + events on native) lives in the host app, which
 * constructs the platform-appropriate impl at boot and registers it
 * here via `setRealtime(...)`.
 *
 * Consumers go through `ws.svelte.ts` (`onWsEvent(op, handler)` etc.) —
 * the dispatch-by-op lives there. This module only covers the wire
 * layer.
 */

export type WsState = 'disconnected' | 'connecting' | 'connected' | 'identified';

export interface RealtimeHandle {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(op: number, d: unknown): Promise<void>;
	subscribeChannels(ids: string[]): Promise<void>;
	unsubscribeChannels(ids: string[]): Promise<void>;
	sendTyping(channelId: string): Promise<void>;
	/** Subscribe to incoming frames. Returns an unsubscribe fn. */
	onFrame(cb: (op: number, d: unknown) => void): () => void;
	/** Subscribe to coarse state transitions. Returns an unsubscribe fn. */
	onState(cb: (state: WsState) => void): () => void;
}

let _handle: RealtimeHandle | null = null;

export function setRealtime(handle: RealtimeHandle | null): void {
	_handle = handle;
}

export function getRealtime(): RealtimeHandle | null {
	return _handle;
}
