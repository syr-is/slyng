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

/**
 * Resolves on the first non-null `setRealtime(...)` call, or rejects
 * if the host signals an init failure via `setRealtimeError(...)`.
 * Mirrors {@link apiReady} — see that promise's doc for the boot-chain
 * story and the failure-signalling rationale.
 */
let _rtResolve: (() => void) | undefined;
let _rtReject: ((err: unknown) => void) | undefined;
export const realtimeReady: Promise<void> = new Promise<void>((resolve, reject) => {
	_rtResolve = resolve;
	_rtReject = reject;
});

function clearRtGate() {
	_rtResolve = undefined;
	_rtReject = undefined;
}

export function setRealtime(handle: RealtimeHandle | null): void {
	_handle = handle;
	if (handle && _rtResolve) {
		_rtResolve();
		clearRtGate();
	}
}

/** Reject `realtimeReady` so consumers fall out of their await on init
 *  failure instead of hanging. See {@link setApiError}'s doc. */
export function setRealtimeError(err: unknown): void {
	if (_rtReject) {
		_rtReject(err);
		clearRtGate();
	}
}

export function getRealtime(): RealtimeHandle | null {
	return _handle;
}
