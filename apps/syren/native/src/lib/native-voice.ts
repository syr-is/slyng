/**
 * Tauri-IPC voice controller.
 *
 * Counterpart to `@syren/app-core/voice/livekit-engine.ts` for the
 * native shell. Same lifecycle (join → mute → leave), but instead of
 * `livekit-client` running in the WebView and grabbing the system mic
 * via `getUserMedia`, this module hands a LiveKit URL + token to the
 * Rust LiveKit SDK via `invoke('voice_*', …)`. Rust owns the
 * `Room`, the `NativeAudioSource` cpal feeds the mic into, and the
 * `NativeAudioStream` mixer cpal pulls remote audio from. Voice
 * lifecycle events come back as `voice-event` Tauri broadcasts which
 * this module routes into the existing `voice-state.svelte.ts`
 * runes.
 *
 * **Status: desktop only.** Mobile (iOS / Android) currently routes
 * its `voice_join` to the same Tauri command, but the Rust side
 * returns `voice not implemented on this platform yet` because the
 * platform-PCM-handoff pipeline (Kotlin `AudioRecord` / iOS
 * `AVAudioEngine` ↔ JNI/FFI ↔ `NativeAudioSource`) isn't wired up
 * yet. Mobile keeps using `livekit-client` in the WebView until that
 * lands.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api } from '@syren/app-core/api';
import { getAuth } from '@syren/app-core/stores/auth.svelte';
import {
	addLocalUserToChannel,
	removeLocalUser,
	setSelfDeaf,
	setSelfMute,
	setVoiceChannel
} from '@syren/app-core/voice/voice-state.svelte';

type VoiceFrame =
	| { event: 'connecting'; channel_id: string }
	| { event: 'connected'; channel_id: string }
	| { event: 'disconnected'; reason: string | null }
	| { event: 'participant_joined'; identity: string }
	| { event: 'participant_left'; identity: string }
	| { event: 'track_subscribed'; participant: string; track_kind: string }
	| { event: 'track_unsubscribed'; participant: string; track_kind: string }
	| { event: 'error'; message: string };

let unlisten: Promise<UnlistenFn> | null = null;
let currentChannelId: string | null = null;
let currentlyMuted = false;
let currentlyDeafened = false;

function selfDid(): string {
	return getAuth().identity?.did ?? '';
}

function ensureListener(): void {
	if (unlisten) return;
	unlisten = listen<VoiceFrame>('voice-event', (e) => {
		const f = e.payload;
		if (import.meta.env.DEV) console.log('[native-voice] event', f);
		switch (f.event) {
			case 'connecting':
				// UI can show a "joining…" spinner if it cares; voice-state
				// only flips to "in voice" on `connected` to avoid showing
				// the user as connected before the room handshake lands.
				break;
			case 'connected': {
				currentChannelId = f.channel_id;
				setVoiceChannel(f.channel_id);
				setSelfMute(false);
				setSelfDeaf(false);
				currentlyMuted = false;
				currentlyDeafened = false;
				const did = selfDid();
				if (did) addLocalUserToChannel(f.channel_id, did);
				break;
			}
			case 'disconnected': {
				const did = selfDid();
				if (did) removeLocalUser(did);
				setVoiceChannel(null);
				currentChannelId = null;
				break;
			}
			case 'error':
				console.warn('[native-voice] error from Rust:', f.message);
				break;
			// participant_joined / left / track_subscribed / track_unsubscribed
			// arrive but the visible roster comes from the gateway's
			// VOICE_STATE_UPDATE_BROADCAST anyway, so we don't need to
			// double-track here.
		}
	});
}

export async function joinVoiceChannel(channelId: string): Promise<void> {
	ensureListener();
	const { token, url } = await api.voice.token(channelId);
	await invoke('voice_join', { url, token, channelId });
}

export async function leaveVoiceChannel(): Promise<void> {
	await invoke('voice_leave');
}

export async function setMicEnabled(enabled: boolean): Promise<void> {
	currentlyMuted = !enabled;
	setSelfMute(currentlyMuted);
	await invoke('voice_set_mic', { enabled });
}

export function toggleMute(): boolean {
	const next = !currentlyMuted;
	void setMicEnabled(!next);
	return next;
}

export function toggleDeafen(): boolean {
	currentlyDeafened = !currentlyDeafened;
	setSelfDeaf(currentlyDeafened);
	// Speaker control isn't fully wired in Rust yet (mixer always
	// flushes to default output); on deafen we just mute the mic too,
	// matching livekit-engine's behaviour.
	void setMicEnabled(!currentlyDeafened);
	void invoke('voice_set_speaker', { enabled: !currentlyDeafened }).catch(() => {});
	return currentlyDeafened;
}

export function isMuted(): boolean {
	return currentlyMuted;
}

export function isDeafened(): boolean {
	return currentlyDeafened;
}

export function getCurrentChannel(): string | null {
	return currentChannelId;
}
