/**
 * LiveKit voice engine — replaces the custom WebRTC mesh.
 *
 * LiveKit handles all media routing (SFU), ICE/DTLS, codec negotiation,
 * and simulcast. This module wraps the LiveKit client SDK and exposes the
 * same public API as the old voice-engine so components stay unchanged.
 */

import {
	Room,
	RoomEvent,
	Track,
	RemoteTrack,
	RemoteTrackPublication,
	RemoteParticipant,
	Participant
} from 'livekit-client';
import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { send, onWsEvent } from '$lib/stores/ws.svelte';
import { setVoiceChannel, setSelfMute, setSelfDeaf, addLocalUserToChannel, removeLocalUser } from './voice-state.svelte';
import { audioConstraints, videoConstraints } from '$lib/stores/media-settings.svelte';
import { getAuth } from '$lib/stores/auth.svelte';
import { api } from '$lib/api';

// ── State ──

let room: Room | null = null;
let currentChannelId: string | null = null;
let deafened = false;
const audioElements = new Map<string, HTMLMediaElement>();

function selfDid(): string {
	return getAuth().identity?.did ?? '';
}

// ── Errors ──

export class MicPermissionError extends Error {
	constructor(public readonly reason: 'denied' | 'no_device' | 'unknown', message: string) {
		super(message);
	}
}

export class ScreenSharePermissionError extends Error {
	constructor(public readonly reason: 'denied' | 'unknown', message: string) {
		super(message);
	}
}

export class CameraPermissionError extends Error {
	constructor(public readonly reason: 'denied' | 'no_device' | 'unknown', message: string) {
		super(message);
	}
}

// ── Room lifecycle ──

export async function joinVoiceChannel(channelId: string): Promise<void> {
	if (currentChannelId) await leaveVoiceChannel();

	const { token, url } = await api.voice.token(channelId);

	room = new Room({
		adaptiveStream: true,
		dynacast: true
	});

	wireRoomEvents(room);

	try {
		await room.connect(url, token);
	} catch (err) {
		room = null;
		throw new MicPermissionError('unknown', (err as Error).message || 'Failed to connect');
	}

	try {
		await room.localParticipant.setMicrophoneEnabled(true);
	} catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError')
			throw new MicPermissionError('denied', 'Microphone access denied');
		if (e.name === 'NotFoundError')
			throw new MicPermissionError('no_device', 'No microphone found');
		throw new MicPermissionError('unknown', e.message || 'Could not access microphone');
	}

	currentChannelId = channelId;
	setVoiceChannel(channelId);
	setSelfMute(false);
	setSelfDeaf(false);
	deafened = false;

	const did = selfDid();
	if (did) addLocalUserToChannel(channelId, did);

	dispatchLocalStream(room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStream ?? null);

	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: channelId, self_mute: false, self_deaf: false, has_camera: false, has_screen: false } });
}

export async function leaveVoiceChannel(): Promise<void> {
	if (room) {
		room.disconnect();
		room = null;
	}

	// Clear all remote streams + audio elements + speaking state
	for (const [, el] of audioElements) { el.pause(); el.remove(); }
	audioElements.clear();
	speakingMap.clear();
	for (const key of [...activeRemoteVideos.keys()]) {
		const [uid, src] = key.split(':') as [string, VideoSource];
		dispatchRemoteVideo(uid, src, null);
	}
	for (const uid of [...activeRemoteAudios.keys()]) dispatchRemoteAudio(uid, null);

	dispatchLocalStream(null);
	dispatchLocalVideo();

	const leavingChannelId = currentChannelId;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: null } });
	currentChannelId = null;
	deafened = false;

	const did = selfDid();
	if (did) removeLocalUser(did);

	setVoiceChannel(null);
}

// ── Audio controls ──

export function toggleMute(): boolean {
	if (!room) return false;
	const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
	if (!pub) return false;
	const next = !pub.isMuted;
	void room.localParticipant.setMicrophoneEnabled(!next);
	broadcastState(next, deafened);
	return next;
}

export function setMicEnabled(enabled: boolean) {
	if (!room) return;
	void room.localParticipant.setMicrophoneEnabled(enabled);
	broadcastState(!enabled, deafened);
}

export function toggleDeafen(): boolean {
	if (!room) return false;
	deafened = !deafened;
	for (const [, el] of audioElements) el.muted = deafened;
	// Deafen implies mute
	const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
	if (micPub) void room.localParticipant.setMicrophoneEnabled(!deafened);
	broadcastState(deafened, deafened);
	return deafened;
}

function broadcastState(selfMute: boolean, selfDeaf: boolean) {
	if (!currentChannelId) return;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: currentChannelId, self_mute: selfMute, self_deaf: selfDeaf } });
}

export function isMuted(): boolean {
	if (!room) return true;
	const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
	return !pub || pub.isMuted;
}

export function isDeafened(): boolean { return deafened; }
export function getCurrentChannel(): string | null { return currentChannelId; }
export function getConnectedPeers(): string[] {
	if (!room) return [];
	return [...room.remoteParticipants.values()].map((p) => p.identity);
}

// ── Video controls ──

export async function startCamera(): Promise<void> {
	if (!room || !currentChannelId) throw new Error('Not in a voice channel');
	if (isCameraOn()) return;
	try {
		await room.localParticipant.setCameraEnabled(true);
	} catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new CameraPermissionError('denied', 'Camera denied');
		if (e.name === 'NotFoundError') throw new CameraPermissionError('no_device', 'No camera');
		throw new CameraPermissionError('unknown', e.message);
	}
	notifyVideoState();
	dispatchLocalVideo();
}

export async function stopCamera(): Promise<void> {
	if (!room) return;
	await room.localParticipant.setCameraEnabled(false);
	notifyVideoState();
	dispatchLocalVideo();
}

export function isCameraOn(): boolean {
	if (!room) return false;
	const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
	return !!pub && !pub.isMuted;
}

export async function startScreenShare(): Promise<void> {
	if (!room || !currentChannelId) throw new Error('Not in a voice channel');
	if (isScreenSharing()) return;
	try {
		await room.localParticipant.setScreenShareEnabled(true, { audio: true });
	} catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new ScreenSharePermissionError('denied', 'Permission denied');
		throw new ScreenSharePermissionError('unknown', e.message || 'Capture failed');
	}
	notifyVideoState();
	dispatchLocalVideo();
}

export async function stopScreenShare(): Promise<void> {
	if (!room) return;
	await room.localParticipant.setScreenShareEnabled(false);
	notifyVideoState();
	dispatchLocalVideo();
}

export function isScreenSharing(): boolean {
	if (!room) return false;
	const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
	return !!pub && !pub.isMuted;
}

function notifyVideoState() {
	if (!currentChannelId) return;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: currentChannelId, has_camera: isCameraOn(), has_screen: isScreenSharing() } });
}

// ── Device switching ──

export async function setMicDevice(): Promise<void> {
	if (!room) return;
	const settings = audioConstraints();
	const deviceId = (settings as any).deviceId?.exact ?? (settings as any).deviceId;
	if (deviceId) await room.switchActiveDevice('audioinput', deviceId);
}

export async function setCameraDevice(): Promise<void> {
	if (!room) return;
	const settings = videoConstraints();
	const deviceId = (settings as any).deviceId?.exact ?? (settings as any).deviceId;
	if (deviceId) await room.switchActiveDevice('videoinput', deviceId);
}

// ── Stream dispatchers ──

export type VideoSource = 'camera' | 'screen';
export type VideoStreamKey = `${string}:${VideoSource}`;
type VideoListener = (key: VideoStreamKey, userId: string, source: VideoSource, stream: MediaStream | null) => void;
type AudioListener = (userId: string, stream: MediaStream | null) => void;
type LocalStreamListener = (stream: MediaStream | null) => void;

const videoListeners = new Set<VideoListener>();
const activeRemoteVideos = new Map<VideoStreamKey, MediaStream>();
const activeRemoteAudios = new Map<string, MediaStream>();
const remoteAudioListeners = new Set<AudioListener>();
const localStreamListeners = new Set<LocalStreamListener>();
const localVideoListeners = new Set<LocalStreamListener>();

export function onRemoteVideo(fn: VideoListener): () => void {
	videoListeners.add(fn);
	for (const [key, stream] of activeRemoteVideos) {
		const [uid, src] = key.split(':') as [string, VideoSource];
		fn(key, uid, src, stream);
	}
	return () => videoListeners.delete(fn);
}

export function onRemoteAudio(fn: AudioListener): () => void {
	remoteAudioListeners.add(fn);
	for (const [userId, stream] of activeRemoteAudios) fn(userId, stream);
	return () => remoteAudioListeners.delete(fn);
}

export function onLocalStream(fn: LocalStreamListener): () => void {
	localStreamListeners.add(fn);
	const micPub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
	fn(micPub?.track?.mediaStream ?? null);
	return () => localStreamListeners.delete(fn);
}

export function onLocalVideo(fn: LocalStreamListener): () => void {
	localVideoListeners.add(fn);
	fn(getLocalVideoStream());
	return () => localVideoListeners.delete(fn);
}

export function getRemoteVideoStreams(): Map<VideoStreamKey, MediaStream> { return new Map(activeRemoteVideos); }
export function getRemoteAudioElement(_userId: string): HTMLAudioElement | undefined { return undefined; }

function getLocalVideoStream(): MediaStream | null {
	if (!room) return null;
	// Prefer camera for the local video preview (self-tile in voice room).
	// Screen share renders in the separate screen-share overlay.
	const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
	if (camPub?.track?.mediaStream) return camPub.track.mediaStream;
	const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
	if (screenPub?.track?.mediaStream) return screenPub.track.mediaStream;
	return null;
}

export function getLocalScreenStream(): MediaStream | null {
	if (!room) return null;
	const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
	return pub?.track?.mediaStream ?? null;
}

export function getLocalCameraStream(): MediaStream | null {
	if (!room) return null;
	const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
	return pub?.track?.mediaStream ?? null;
}

function dispatchRemoteVideo(userId: string, source: VideoSource, stream: MediaStream | null) {
	const key: VideoStreamKey = `${userId}:${source}`;
	if (stream) activeRemoteVideos.set(key, stream);
	else activeRemoteVideos.delete(key);
	for (const fn of videoListeners) fn(key, userId, source, stream);
}

function dispatchRemoteAudio(userId: string, stream: MediaStream | null) {
	if (stream) activeRemoteAudios.set(userId, stream);
	else activeRemoteAudios.delete(userId);
	for (const fn of remoteAudioListeners) fn(userId, stream);
}

function dispatchLocalStream(stream: MediaStream | null) {
	for (const fn of localStreamListeners) fn(stream);
}

function dispatchLocalVideo() {
	const s = getLocalVideoStream();
	for (const fn of localVideoListeners) fn(s);
}

// ── LiveKit room event wiring ──

function wireRoomEvents(r: Room) {
	r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
		const uid = participant.identity;
		if (track.kind === Track.Kind.Audio) {
			// Attach creates a DOM <audio> element and starts playback
			const el = track.attach();
			el.style.display = 'none';
			document.body.appendChild(el);
			audioElements.set(uid, el);
			if (deafened) el.muted = true;
			dispatchRemoteAudio(uid, track.mediaStream ?? null);
		} else if (track.kind === Track.Kind.Video) {
			const source: VideoSource = pub.source === Track.Source.ScreenShare ? 'screen' : 'camera';
			dispatchRemoteVideo(uid, source, track.mediaStream ?? null);
		}
	});

	r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
		const uid = participant.identity;
		if (track.kind === Track.Kind.Audio) {
			const el = audioElements.get(uid);
			if (el) { el.pause(); el.remove(); audioElements.delete(uid); }
			dispatchRemoteAudio(uid, null);
		} else if (track.kind === Track.Kind.Video) {
			const source: VideoSource = _pub.source === Track.Source.ScreenShare ? 'screen' : 'camera';
			dispatchRemoteVideo(uid, source, null);
		}
	});

	r.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
		const uid = participant.identity;
		dispatchRemoteVideo(uid, 'camera', null);
		dispatchRemoteVideo(uid, 'screen', null);
		dispatchRemoteAudio(uid, null);
	});

	r.on(RoomEvent.Disconnected, () => {
		for (const key of [...activeRemoteVideos.keys()]) {
			const [uid, src] = key.split(':') as [string, VideoSource];
			dispatchRemoteVideo(uid, src, null);
		}
		for (const uid of [...activeRemoteAudios.keys()]) dispatchRemoteAudio(uid, null);
		dispatchLocalStream(null);
		dispatchLocalVideo();
	});

	r.on(RoomEvent.LocalTrackPublished, () => {
		dispatchLocalVideo();
		const micPub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
		dispatchLocalStream(micPub?.track?.mediaStream ?? null);
	});

	r.on(RoomEvent.LocalTrackUnpublished, () => {
		dispatchLocalVideo();
	});

	r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
		const active = new Set(speakers.map((s) => s.identity));
		// Mark all current speakers, clear everyone else
		for (const [uid] of speakingMap) {
			if (!active.has(uid)) speakingMap.set(uid, false);
		}
		for (const s of speakers) {
			speakingMap.set(s.identity, true);
		}
	});
}

// ── Speaking detection ──
// Reactive SvelteMap so Svelte components re-render when speaking state changes.
const speakingMap = new SvelteMap<string, boolean>();

export function isSpeaking(participantId: string): boolean {
	return speakingMap.get(participantId) ?? false;
}

export function getSpeakingMap(): SvelteMap<string, boolean> { return speakingMap; }

export function getRoom(): Room | null { return room; }
