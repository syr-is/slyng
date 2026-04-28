/**
 * Native (Tauri) voice bridge.
 *
 * `livekit-engine.ts` is the *single* public-surface module every UI
 * consumer imports for voice. Inside its entry points we branch on
 * `isTauri()` and delegate to this bridge — Tauri commands +
 * `voice-event` listeners — instead of running `livekit-client` in
 * the WebView. The mediaDevices APIs that `livekit-client` reaches
 * for (`getUserMedia`, `enumerateDevices`) aren't exposed in Tauri's
 * WebView, so trying to `Room::connect` from JS just throws —
 * everything has to go via the Rust side.
 *
 * Web builds never call any of these functions because `isTauri()`
 * returns false; the dynamic Tauri imports tree-shake away.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

type VoiceFrame =
	| { event: 'connecting'; channel_id: string }
	| { event: 'connected'; channel_id: string }
	| { event: 'disconnected'; reason: string | null }
	| { event: 'participant_joined'; identity: string }
	| { event: 'participant_left'; identity: string }
	| { event: 'track_subscribed'; participant: string; track_kind: string }
	| { event: 'track_unsubscribed'; participant: string; track_kind: string }
	| { event: 'error'; message: string };

type FrameHandler = (frame: VoiceFrame) => void;

const frameHandlers = new Set<FrameHandler>();
let unlisten: Promise<UnlistenFn> | null = null;

function ensureListener(): void {
	if (unlisten || !isTauri()) return;
	unlisten = listen<VoiceFrame>('voice-event', (e) => {
		for (const fn of frameHandlers) fn(e.payload);
	});
}

export function onVoiceEvent(handler: FrameHandler): () => void {
	ensureListener();
	frameHandlers.add(handler);
	return () => frameHandlers.delete(handler);
}

export async function nativeJoin(url: string, token: string, channelId: string): Promise<void> {
	ensureListener();
	await invoke('voice_join', { url, token, channelId });
}

export async function nativeLeave(): Promise<void> {
	await invoke('voice_leave');
}

export async function nativeSetMic(enabled: boolean): Promise<void> {
	await invoke('voice_set_mic', { enabled });
}

export async function nativeSetSpeaker(enabled: boolean): Promise<void> {
	await invoke('voice_set_speaker', { enabled });
}

export async function nativeSetCamera(enabled: boolean): Promise<void> {
	await invoke('voice_set_camera', { enabled });
}
