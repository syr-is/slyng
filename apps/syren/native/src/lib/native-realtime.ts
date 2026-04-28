/**
 * Native realtime handle. Tauri-IPC backed: every action is an `invoke`,
 * incoming frames arrive as `realtime-frame` events, state transitions
 * as `realtime-state`. JS never opens a socket directly.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RealtimeHandle, WsState } from '@syren/client';

interface FramePayload {
	op: number;
	d: unknown;
}

export function createNativeRealtime(apiHost: string): RealtimeHandle {
	const frameSubs = new Set<(op: number, d: unknown) => void>();
	const stateSubs = new Set<(s: WsState) => void>();
	let frameUnlisten: Promise<UnlistenFn> | null = null;
	let stateUnlisten: Promise<UnlistenFn> | null = null;

	function ensureFrameListener() {
		if (!frameUnlisten) {
			frameUnlisten = listen<FramePayload>('realtime-frame', (e) => {
				const { op, d } = e.payload;
				if (import.meta.env.DEV)
					console.log(`[native-realtime] frame op=${op} subs=${frameSubs.size}`);
				for (const fn of frameSubs) fn(op, d);
			});
		}
	}

	function ensureStateListener() {
		if (!stateUnlisten) {
			stateUnlisten = listen<string>('realtime-state', (e) => {
				const state = e.payload as WsState;
				if (import.meta.env.DEV) console.log(`[native-realtime] state=${state}`);
				for (const fn of stateSubs) fn(state);
			});
		}
	}

	return {
		connect: () => invoke('realtime_connect', { apiHost }),
		disconnect: () => invoke('realtime_disconnect', { apiHost }),
		send: (op, d) => invoke('realtime_send', { apiHost, op, d }),
		subscribeChannels: (ids) => invoke('realtime_subscribe_channels', { apiHost, channelIds: ids }),
		unsubscribeChannels: (ids) =>
			invoke('realtime_unsubscribe_channels', { apiHost, channelIds: ids }),
		sendTyping: (channelId) => invoke('realtime_send_typing', { apiHost, channelId }),
		onFrame(cb) {
			frameSubs.add(cb);
			ensureFrameListener();
			return () => frameSubs.delete(cb);
		},
		onState(cb) {
			stateSubs.add(cb);
			ensureStateListener();
			return () => stateSubs.delete(cb);
		}
	};
}
