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

export async function nativeJoin(
	url: string,
	token: string,
	channelId: string,
	selfIdentity: string
): Promise<void> {
	ensureListener();
	await invoke('voice_join', { url, token, channelId, selfIdentity });
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

// ── Device enumeration / picking ────────────────────────────────────
//
// Tauri WebView has no `navigator.mediaDevices`, so the Settings UI
// asks Rust for the device list directly. cpal does the audio side
// (CoreAudio / WASAPI / ALSA-PulseAudio), nokhwa does cameras
// (AVFoundation / Media Foundation / V4L2). The chosen device is
// persisted in the Rust voice handle so the next `voice_join` builds
// the cpal pipeline against it; mid-call switches rebuild only the
// affected stream without dropping the room.

export interface NativeDevice {
	id: string;
	label: string;
	is_default: boolean;
}

export async function nativeListAudioInputs(): Promise<NativeDevice[]> {
	if (!isTauri()) return [];
	return invoke<NativeDevice[]>('audio_list_inputs');
}

export async function nativeListAudioOutputs(): Promise<NativeDevice[]> {
	if (!isTauri()) return [];
	return invoke<NativeDevice[]>('audio_list_outputs');
}

export async function nativeListCameras(): Promise<NativeDevice[]> {
	if (!isTauri()) return [];
	return invoke<NativeDevice[]>('video_list_cameras');
}

export async function nativeSetInputDevice(deviceId: string | null): Promise<void> {
	await invoke('voice_set_input_device', { deviceId });
}

export async function nativeSetOutputDevice(deviceId: string | null): Promise<void> {
	await invoke('voice_set_output_device', { deviceId });
}

export async function nativeSetCameraDevice(deviceId: string | null): Promise<void> {
	await invoke('voice_set_camera_device', { deviceId });
}

/**
 * `null` resets to "use whatever the camera negotiates by default".
 * `Some(n)` re-requests the camera at that exact frame rate (preview
 * + in-call), falling back to the camera's chosen rate if the camera
 * doesn't list that fps for the current resolution.
 */
export async function nativeSetCameraFps(fps: number | null): Promise<void> {
	await invoke('voice_set_camera_fps', { fps });
}

/** Highest fps the camera advertises at its highest resolution. */
export async function nativeCameraMaxFps(deviceId: string | null): Promise<number> {
	return invoke<number>('voice_camera_max_fps', { deviceId });
}

/** Participant id Rust uses for the standalone Settings preview frames. */
export const NATIVE_PREVIEW_PARTICIPANT = '__preview__';

export async function nativePreviewStart(deviceId: string | null): Promise<void> {
	await invoke('voice_preview_start', { deviceId });
}

export async function nativePreviewStop(): Promise<void> {
	await invoke('voice_preview_stop');
}

// ── Remote video frames ─────────────────────────────────────────────
//
// Each subscribed remote video track on the Rust side decodes I420 to
// RGB, JPEG-encodes the frame, and emits `voice-video-frame` Tauri
// events with the participant identity + base64 JPEG payload. The JS
// side decodes back to an `<img>`/canvas paint per participant.

export interface VoiceVideoFrame {
	participant: string;
	track_sid: string;
	width: number;
	height: number;
	jpeg_b64: string;
}

type FrameListener = (frame: VoiceVideoFrame) => void;
const frameListeners = new Set<FrameListener>();
let unlistenFrames: Promise<UnlistenFn> | null = null;

function ensureFrameListener(): void {
	if (unlistenFrames || !isTauri()) return;
	unlistenFrames = listen<VoiceVideoFrame>('voice-video-frame', (e) => {
		for (const fn of frameListeners) fn(e.payload);
	});
}

export function onVoiceVideoFrame(handler: FrameListener): () => void {
	ensureFrameListener();
	frameListeners.add(handler);
	return () => frameListeners.delete(handler);
}
