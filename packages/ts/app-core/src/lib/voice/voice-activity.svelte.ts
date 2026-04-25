/**
 * Voice-activity detection.
 *
 * Local mic: Web Audio analyser (createMediaStreamSource works for local streams).
 * Remote peers: RTCPeerConnection.getStats() polling for inbound audio energy.
 * Chrome's Web Audio API can't reliably pipe WebRTC receiver tracks through
 * AudioNode graphs, so we read stats directly from the RTP decoder.
 */

import { SvelteMap } from 'svelte/reactivity';
import { onLocalStream, onRemoteAudio } from './voice-engine';
import { getAuth } from '../stores/auth.svelte';
import getPeersMap from './voice-engine-peers';

const speaking = new SvelteMap<string, boolean>();

interface Monitor { cancel: () => void }
const monitors = new Map<string, Monitor>();

const THRESHOLD = 0.01;
const SILENT_HOLD_MS = 250;

// ── Local mic VAD (Web Audio — works perfectly for local streams) ──

function attachLocalMonitor(userId: string, stream: MediaStream | null) {
	monitors.get(userId)?.cancel();
	monitors.delete(userId);
	if (!stream || !stream.getAudioTracks().length) { speaking.delete(userId); return; }

	const ctx = new AudioContext();
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.5;
	const source = ctx.createMediaStreamSource(stream);
	const silent = ctx.createGain();
	silent.gain.value = 0;
	source.connect(analyser);
	analyser.connect(silent);
	silent.connect(ctx.destination);

	const buffer = new Uint8Array(analyser.fftSize);
	let raf = 0;
	let silentSince = 0;

	const loop = () => {
		analyser.getByteTimeDomainData(buffer);
		let sumSq = 0;
		for (let i = 0; i < buffer.length; i++) { const v = (buffer[i] - 128) / 128; sumSq += v * v; }
		const rms = Math.sqrt(sumSq / buffer.length);
		const now = performance.now();
		if (rms > THRESHOLD) {
			silentSince = 0;
			if (!speaking.get(userId)) speaking.set(userId, true);
		} else {
			if (!silentSince) silentSince = now;
			if (now - silentSince > SILENT_HOLD_MS && speaking.get(userId)) speaking.set(userId, false);
		}
		raf = requestAnimationFrame(loop);
	};
	loop();

	monitors.set(userId, {
		cancel: () => {
			cancelAnimationFrame(raf);
			source.disconnect(); analyser.disconnect(); silent.disconnect();
			ctx.close().catch(() => {});
			speaking.set(userId, false);
		}
	});
}

// ── Remote peers VAD (WebRTC stats polling) ──

let pollTimer: ReturnType<typeof setInterval> | null = null;
const silentSinceMap = new Map<string, number>();

function startRemotePolling() {
	if (pollTimer) return;
	pollTimer = setInterval(async () => {
		const peerMap = getPeersMap();
		if (peerMap.size === 0) return;
		const now = performance.now();

		for (const [userId, pc] of peerMap) {
			if (pc.connectionState !== 'connected') continue;
			try {
				const stats = await pc.getStats();
				let level = 0;
				let found = false;
				stats.forEach((r: any) => {
					// Chrome: inbound-rtp with kind=audio or mediaType=audio
					if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) {
						found = true;
						// audioLevel is on the inbound-rtp report in modern Chrome
						if (r.audioLevel !== undefined) level = Math.max(level, r.audioLevel);
					}
					// Fallback: track stats (older Chrome)
					if (r.type === 'track' && r.kind === 'audio' && !r.remoteSource === false) {
						if (r.audioLevel !== undefined) level = Math.max(level, r.audioLevel);
						found = true;
					}
				});

				// If no audioLevel found in stats, try totalAudioEnergy delta
				if (found && level === 0) {
					// Check totalAudioEnergy as alternative signal
					stats.forEach((r: any) => {
						if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) {
							if (r.totalAudioEnergy !== undefined && r.totalSamplesDuration !== undefined && r.totalSamplesDuration > 0) {
								// Average energy since connection start
								const avgEnergy = r.totalAudioEnergy / r.totalSamplesDuration;
								level = Math.max(level, avgEnergy);
							}
						}
					});
				}

				if (level > THRESHOLD) {
					silentSinceMap.delete(userId);
					if (!speaking.get(userId)) speaking.set(userId, true);
				} else {
					if (!silentSinceMap.has(userId)) silentSinceMap.set(userId, now);
					const since = silentSinceMap.get(userId)!;
					if (now - since > SILENT_HOLD_MS && speaking.get(userId)) speaking.set(userId, false);
				}
			} catch { /* pc closing */ }
		}
	}, 100);
}

function stopRemotePolling() {
	if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	silentSinceMap.clear();
}

// ── Init ──

let initialized = false;
function init() {
	if (initialized) return;
	initialized = true;

	onLocalStream((stream) => {
		const did = getAuth().identity?.did;
		if (did) attachLocalMonitor(did, stream);
		if (stream) startRemotePolling();
		else stopRemotePolling();
	});

	onRemoteAudio((userId, stream) => {
		if (!stream) { speaking.delete(userId); silentSinceMap.delete(userId); }
	});
}

export function getVoiceActivity() {
	init();
	return {
		get map() { return speaking; },
		isSpeaking(userId: string): boolean { return speaking.get(userId) ?? false; }
	};
}
