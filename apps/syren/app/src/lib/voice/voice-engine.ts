/**
 * WebRTC voice engine — simple mesh topology.
 *
 * Design:
 * - One RTCPeerConnection per peer, audio only via addTrack (no transceivers)
 * - Deterministic offerer: lexicographically smaller DID always offers
 * - ICE candidates queued until remoteDescription is set
 * - ontrack used for receiving remote audio (always fires with addTrack)
 * - No renegotiation, no rollback, no glare
 */

import { WsOp } from '@syren/types';
import { send, onWsEvent, subscribeChannels, unsubscribeChannels } from '$lib/stores/ws.svelte';
import { setVoiceChannel, setSelfMute, setSelfDeaf, addLocalUserToChannel, removeLocalUser } from './voice-state.svelte';
import { audioConstraints, videoConstraints } from '$lib/stores/media-settings.svelte';
import { getAuth } from '$lib/stores/auth.svelte';
import { setPeersGetter } from './voice-engine-peers';

const OP_VOICE_OFFER = 100;
const OP_VOICE_ANSWER = 101;
const OP_VOICE_ICE = 102;

const ICE_SERVERS: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' }
];

// ── State ──

const peers = new Map<string, RTCPeerConnection>();
setPeersGetter(() => peers);
const remoteAudios = new Map<string, HTMLAudioElement>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();
const audioSenders = new Map<string, RTCRtpSender>();
const videoSenders = new Map<string, RTCRtpSender>();

let localStream: MediaStream | null = null;
let currentChannelId: string | null = null;
let deafened = false;
let screenStream: MediaStream | null = null;
let cameraStream: MediaStream | null = null;

function selfDid(): string {
	return getAuth().identity?.did ?? '';
}

/** Deterministic: smaller DID is the offerer. Eliminates glare. */
function isOfferer(remoteUserId: string): boolean {
	return selfDid() < remoteUserId;
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

// ── Peer connection ──

function destroyPeer(userId: string) {
	const pc = peers.get(userId);
	if (pc) pc.close();
	peers.delete(userId);
	pendingIce.delete(userId);
	remoteAudios.get(userId)?.pause();
	remoteAudios.delete(userId);
	audioSenders.delete(userId);
	videoSenders.delete(userId);
	dispatchRemoteVideo(userId, null);
	dispatchRemoteAudio(userId, null);
}

function createPeerConnection(targetUserId: string): RTCPeerConnection {
	// Destroy any existing connection first
	if (peers.has(targetUserId)) destroyPeer(targetUserId);

	console.log(`[voice] createPC ${targetUserId.slice(0, 20)} offerer=${isOfferer(targetUserId)} hasLocalStream=${!!localStream} audioTracks=${localStream?.getAudioTracks().length ?? 0}`);
	const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
	peers.set(targetUserId, pc);

	// Add local audio track
	if (localStream) {
		const audioTrack = localStream.getAudioTracks()[0];
		if (audioTrack) {
			console.log(`[voice] addTrack audio → ${targetUserId.slice(0, 20)} enabled=${audioTrack.enabled} readyState=${audioTrack.readyState}`);
			const sender = pc.addTrack(audioTrack, localStream);
			audioSenders.set(targetUserId, sender);
		}
	} else {
		console.warn(`[voice] NO localStream when creating PC for ${targetUserId.slice(0, 20)}`);
	}

	// Receive remote media via ontrack
	pc.ontrack = (event) => {
		const track = event.track;
		const stream = event.streams[0] ?? new MediaStream([track]);
		console.log(`[voice] ontrack ${targetUserId.slice(0, 20)} kind=${track.kind} readyState=${track.readyState} muted=${track.muted}`);

		if (track.kind === 'audio') {
			// Clean up any previous audio element
			const prev = remoteAudios.get(targetUserId);
			if (prev) { prev.pause(); prev.srcObject = null; }

			const audio = document.createElement('audio');
			audio.srcObject = stream;
			audio.autoplay = true;
			audio.muted = deafened; // only mute if user is deafened
			audio.volume = 1.0;
			// Prevent garbage collection
			audio.setAttribute('data-peer', targetUserId);
			remoteAudios.set(targetUserId, audio);

			// Robust playback: handle autoplay policy
			const tryPlay = () => {
				audio.play().then(() => {
					console.log(`[voice] audio playing for ${targetUserId.slice(0, 20)}`);
				}).catch((err) => {
					console.warn(`[voice] audio.play() blocked for ${targetUserId.slice(0, 20)}:`, err.message);
					// Retry on next user interaction
					const resume = () => {
						audio.play().catch(() => {});
						document.removeEventListener('click', resume);
						document.removeEventListener('keydown', resume);
					};
					document.addEventListener('click', resume, { once: true });
					document.addEventListener('keydown', resume, { once: true });
				});
			};
			tryPlay();

			// If the track starts muted (no RTP yet), retry playback when it unmutes
			if (track.muted) {
				track.onunmute = () => {
					console.log(`[voice] track unmuted for ${targetUserId.slice(0, 20)}`);
					tryPlay();
				};
			}

			dispatchRemoteAudio(targetUserId, stream);
		} else if (track.kind === 'video') {
			dispatchRemoteVideo(targetUserId, stream);
		}
	};

	// ICE candidates → send to peer
	pc.onicecandidate = (event) => {
		if (event.candidate) {
			send({
				op: OP_VOICE_ICE,
				d: { target_user_id: targetUserId, candidate: event.candidate.toJSON() }
			});
		}
	};

	// Connection state logging + cleanup
	pc.onconnectionstatechange = () => {
		console.log(`[voice] ${targetUserId.slice(0, 20)} conn=${pc.connectionState}`);
		if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
			destroyPeer(targetUserId);
		}
	};

	pc.oniceconnectionstatechange = () => {
		console.log(`[voice] ${targetUserId.slice(0, 20)} ice=${pc.iceConnectionState}`);
	};

	return pc;
}

async function startOffer(targetUserId: string) {
	const pc = peers.get(targetUserId);
	if (!pc) return;
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	console.log(`[voice] sent offer → ${targetUserId.slice(0, 20)}`);
	send({ op: OP_VOICE_OFFER, d: { target_user_id: targetUserId, sdp: offer.sdp, type: offer.type } });
}

async function flushIce(userId: string) {
	const queued = pendingIce.get(userId);
	if (!queued?.length) return;
	pendingIce.delete(userId);
	const pc = peers.get(userId);
	if (!pc) return;
	for (const c of queued) {
		try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
	}
}

/** Connect to a peer. Deterministic offerer decides who sends the offer. */
async function connectToPeer(targetUserId: string) {
	// Never connect to self
	if (targetUserId === selfDid()) return;
	// Must have local stream before creating peer connections
	if (!localStream) {
		console.warn(`[voice] skipping connectToPeer(${targetUserId.slice(0, 20)}) — no localStream`);
		return;
	}
	createPeerConnection(targetUserId);
	if (isOfferer(targetUserId)) {
		await startOffer(targetUserId);
	}
}

// ── Public API ──

export async function joinVoiceChannel(channelId: string): Promise<void> {
	if (currentChannelId) await leaveVoiceChannel();

	if (!navigator.mediaDevices?.getUserMedia) {
		throw new MicPermissionError('unknown', 'Voice requires a secure context (HTTPS or localhost).');
	}

	try {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false });
	} catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')
			throw new MicPermissionError('denied', 'Microphone access denied');
		if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError')
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

	subscribeChannels([channelId]);
	dispatchLocalStream(localStream);
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: channelId, self_mute: false, self_deaf: false } });
}

export async function leaveVoiceChannel(): Promise<void> {
	// Destroy all peers
	for (const userId of [...peers.keys()]) destroyPeer(userId);

	stopScreenShareInternal();
	cameraStream?.getTracks().forEach((t) => t.stop());
	cameraStream = null;
	dispatchLocalVideo();

	localStream?.getTracks().forEach((t) => t.stop());
	localStream = null;
	dispatchLocalStream(null);

	const leavingChannelId = currentChannelId;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: null } });
	currentChannelId = null;
	deafened = false;

	const did = selfDid();
	if (did) removeLocalUser(did);

	setVoiceChannel(null);
	if (leavingChannelId) unsubscribeChannels([leavingChannelId]);
}

export function toggleMute(): boolean {
	if (!localStream) return false;
	const t = localStream.getAudioTracks()[0];
	if (!t) return false;
	t.enabled = !t.enabled;
	broadcastState(!t.enabled, deafened);
	return !t.enabled;
}

export function setMicEnabled(enabled: boolean) {
	if (!localStream) return;
	const t = localStream.getAudioTracks()[0];
	if (!t) return;
	t.enabled = enabled;
	broadcastState(!enabled, deafened);
}

export function toggleDeafen(): boolean {
	if (!localStream) return false;
	deafened = !deafened;
	for (const [, audio] of remoteAudios) audio.muted = deafened;
	const t = localStream.getAudioTracks()[0];
	if (t) t.enabled = !deafened;
	broadcastState(deafened, deafened);
	return deafened;
}

function broadcastState(selfMute: boolean, selfDeaf: boolean) {
	if (!currentChannelId) return;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: currentChannelId, self_mute: selfMute, self_deaf: selfDeaf } });
}

export function isMuted(): boolean { return localStream?.getAudioTracks()[0] ? !localStream.getAudioTracks()[0].enabled : true; }
export function isDeafened(): boolean { return deafened; }
export function getCurrentChannel(): string | null { return currentChannelId; }
export function getConnectedPeers(): string[] { return [...peers.keys()]; }

export async function setMicDevice(): Promise<void> {
	if (!currentChannelId) return;
	if (!navigator.mediaDevices?.getUserMedia) throw new MicPermissionError('unknown', 'Media unavailable');
	let ns: MediaStream;
	try { ns = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false }); }
	catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new MicPermissionError('denied', 'Microphone access denied');
		if (e.name === 'NotFoundError') throw new MicPermissionError('no_device', 'Microphone not found');
		throw new MicPermissionError('unknown', e.message);
	}
	const nt = ns.getAudioTracks()[0];
	if (!nt) { ns.getTracks().forEach((t) => t.stop()); throw new MicPermissionError('no_device', 'No audio track'); }
	nt.enabled = !deafened && !isMuted();
	for (const [, sender] of audioSenders) await sender.replaceTrack(nt);
	localStream?.getAudioTracks().forEach((t) => t.stop());
	localStream = ns;
	dispatchLocalStream(localStream);
}

// ── Video (screen share / camera) ──

function notifyVideoState() {
	if (!currentChannelId) return;
	send({ op: WsOp.VOICE_STATE_UPDATE, d: { channel_id: currentChannelId, has_camera: cameraStream !== null, has_screen: screenStream !== null } });
}

export async function startScreenShare(): Promise<void> {
	if (!currentChannelId) throw new Error('Not in a voice channel');
	if (screenStream) return;
	if (!navigator.mediaDevices?.getDisplayMedia) throw new ScreenSharePermissionError('unknown', 'Screen share unavailable');
	if (cameraStream) await stopCamera();
	try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false }); }
	catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new ScreenSharePermissionError('denied', 'Permission denied');
		throw new ScreenSharePermissionError('unknown', e.message || 'Capture failed');
	}
	const vt = screenStream.getVideoTracks()[0];
	if (!vt) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; throw new ScreenSharePermissionError('unknown', 'No track'); }
	vt.onended = () => { void stopScreenShare(); };
	for (const [, sender] of videoSenders) await sender.replaceTrack(vt);
	notifyVideoState();
	dispatchLocalVideo();
}

export async function stopScreenShare(): Promise<void> {
	if (!screenStream) return;
	stopScreenShareInternal();
	for (const [, sender] of videoSenders) await sender.replaceTrack(null);
	notifyVideoState();
	dispatchLocalVideo();
}

function stopScreenShareInternal() { screenStream?.getTracks().forEach((t) => t.stop()); screenStream = null; }
export function isScreenSharing(): boolean { return screenStream !== null; }

export async function startCamera(): Promise<void> {
	if (!currentChannelId) throw new Error('Not in a voice channel');
	if (cameraStream) return;
	if (!navigator.mediaDevices?.getUserMedia) throw new CameraPermissionError('unknown', 'Camera unavailable');
	if (screenStream) await stopScreenShare();
	try { cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints() }); }
	catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new CameraPermissionError('denied', 'Camera denied');
		if (e.name === 'NotFoundError') throw new CameraPermissionError('no_device', 'No camera');
		throw new CameraPermissionError('unknown', e.message);
	}
	const vt = cameraStream.getVideoTracks()[0];
	if (!vt) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; throw new CameraPermissionError('unknown', 'No track'); }
	vt.onended = () => { void stopCamera(); };
	for (const [, sender] of videoSenders) await sender.replaceTrack(vt);
	notifyVideoState();
	dispatchLocalVideo();
}

export async function stopCamera(): Promise<void> {
	if (!cameraStream) return;
	cameraStream.getTracks().forEach((t) => t.stop());
	cameraStream = null;
	for (const [, sender] of videoSenders) await sender.replaceTrack(null);
	notifyVideoState();
	dispatchLocalVideo();
}

export function isCameraOn(): boolean { return cameraStream !== null; }

export async function setCameraDevice(): Promise<void> {
	if (!cameraStream) return;
	if (!navigator.mediaDevices?.getUserMedia) throw new CameraPermissionError('unknown', 'Unavailable');
	let ns: MediaStream;
	try { ns = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints() }); }
	catch (err) {
		const e = err as DOMException;
		if (e.name === 'NotAllowedError') throw new CameraPermissionError('denied', 'Denied');
		if (e.name === 'NotFoundError') throw new CameraPermissionError('no_device', 'Not found');
		throw new CameraPermissionError('unknown', (err as Error).message);
	}
	const nt = ns.getVideoTracks()[0];
	if (!nt) { ns.getTracks().forEach((t) => t.stop()); throw new CameraPermissionError('unknown', 'No track'); }
	nt.onended = () => { void stopCamera(); };
	for (const [, sender] of videoSenders) await sender.replaceTrack(nt);
	cameraStream.getTracks().forEach((t) => t.stop());
	cameraStream = ns;
	dispatchLocalVideo();
}

// ── Stream dispatchers ──

type VideoListener = (userId: string, stream: MediaStream | null) => void;
type AudioListener = (userId: string, stream: MediaStream | null) => void;
type LocalStreamListener = (stream: MediaStream | null) => void;

const videoListeners = new Set<VideoListener>();
const activeRemoteVideos = new Map<string, MediaStream>();
const remoteAudioListeners = new Set<AudioListener>();
const localStreamListeners = new Set<LocalStreamListener>();
const localVideoListeners = new Set<LocalStreamListener>();

export function onRemoteVideo(fn: VideoListener): () => void {
	videoListeners.add(fn);
	for (const [userId, stream] of activeRemoteVideos) fn(userId, stream);
	return () => videoListeners.delete(fn);
}

export function getRemoteAudioElement(userId: string): HTMLAudioElement | undefined {
	return remoteAudios.get(userId);
}

export function onRemoteAudio(fn: AudioListener): () => void {
	remoteAudioListeners.add(fn);
	for (const [userId, audio] of remoteAudios) {
		const s = audio.srcObject;
		if (s instanceof MediaStream) fn(userId, s);
	}
	return () => remoteAudioListeners.delete(fn);
}

export function onLocalStream(fn: LocalStreamListener): () => void {
	localStreamListeners.add(fn);
	fn(localStream);
	return () => localStreamListeners.delete(fn);
}

export function onLocalVideo(fn: LocalStreamListener): () => void {
	localVideoListeners.add(fn);
	fn(cameraStream ?? screenStream);
	return () => localVideoListeners.delete(fn);
}

function dispatchRemoteVideo(userId: string, stream: MediaStream | null) {
	if (stream) activeRemoteVideos.set(userId, stream);
	else activeRemoteVideos.delete(userId);
	for (const fn of videoListeners) fn(userId, stream);
}

function dispatchRemoteAudio(userId: string, stream: MediaStream | null) {
	for (const fn of remoteAudioListeners) fn(userId, stream);
}

function dispatchLocalStream(stream: MediaStream | null) {
	for (const fn of localStreamListeners) fn(stream);
}

function dispatchLocalVideo() {
	const s = cameraStream ?? screenStream ?? null;
	for (const fn of localVideoListeners) fn(s);
}

export function getRemoteVideoStreams(): Map<string, MediaStream> { return new Map(activeRemoteVideos); }

// ── WS signal handlers ──

onWsEvent(WsOp.VOICE_STATE_UPDATE_BROADCAST, (data: unknown) => {
	const d = data as { action: string; user_id?: string; channel_id?: string; users?: { user_id: string }[] };

	// Server sends list of existing users when we join → connect to each
	if (d.action === 'channel_users' && d.users) {
		const self = selfDid();
		console.log(`[voice] channel_users: ${d.users.length} users, self=${self.slice(0, 20)}, users=${d.users.map(u => u.user_id.slice(0, 20)).join(',')}`);
		for (const user of d.users) {
			if (user.user_id !== self && !peers.has(user.user_id)) {
				connectToPeer(user.user_id);
			}
		}
	}

	// Another user joined → connect to them (deterministic offerer decides who offers)
	if (d.action === 'join' && d.user_id && d.user_id !== selfDid()) {
		if (!peers.has(d.user_id)) {
			connectToPeer(d.user_id);
		}
	}

	// User left → tear down their peer connection
	if (d.action === 'leave' && d.user_id) {
		destroyPeer(d.user_id);
	}
});

onWsEvent(OP_VOICE_OFFER, async (data: unknown) => {
	const d = data as { from_user_id: string; sdp: string; type: RTCSdpType };
	if (d.from_user_id === selfDid()) return; // ignore self
	console.log(`[voice] offer ← ${d.from_user_id.slice(0, 20)}`);

	let pc = peers.get(d.from_user_id);
	if (!pc) {
		pc = createPeerConnection(d.from_user_id);
	}

	console.log(`[voice] setRemoteDescription(offer) for ${d.from_user_id.slice(0, 20)} signalingState=${pc.signalingState}`);
	await pc.setRemoteDescription(new RTCSessionDescription({ sdp: d.sdp, type: d.type }));
	console.log(`[voice] remoteDescription set, signalingState=${pc.signalingState}`);
	await flushIce(d.from_user_id);

	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);
	console.log(`[voice] answer → ${d.from_user_id.slice(0, 20)}`);
	send({ op: OP_VOICE_ANSWER, d: { target_user_id: d.from_user_id, sdp: answer.sdp, type: answer.type } });
});

onWsEvent(OP_VOICE_ANSWER, async (data: unknown) => {
	const d = data as { from_user_id: string; sdp: string; type: RTCSdpType };
	console.log(`[voice] answer ← ${d.from_user_id.slice(0, 20)}`);
	const pc = peers.get(d.from_user_id);
	if (!pc) return;
	if (pc.signalingState !== 'have-local-offer') {
		console.log(`[voice] ignoring answer, state=${pc.signalingState}`);
		return;
	}
	await pc.setRemoteDescription(new RTCSessionDescription({ sdp: d.sdp, type: d.type }));
	await flushIce(d.from_user_id);
});

onWsEvent(OP_VOICE_ICE, async (data: unknown) => {
	const d = data as { from_user_id: string; candidate: RTCIceCandidateInit };
	const pc = peers.get(d.from_user_id);
	if (!pc || !pc.remoteDescription) {
		let q = pendingIce.get(d.from_user_id);
		if (!q) { q = []; pendingIce.set(d.from_user_id, q); }
		q.push(d.candidate);
		return;
	}
	try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch { /* stale */ }
});
