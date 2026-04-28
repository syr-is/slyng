/**
 * Wrappers around `navigator.mediaDevices` for the Settings UI.
 *
 * Browsers only reveal device labels once the user has granted at least one
 * media permission (audio OR video) on this origin. Without labels, a list of
 * mics is just opaque `default`, `communications`, `<uuid>` entries — which
 * is useless to pick from. `primeDevicePermissions` opens a throwaway stream
 * just long enough for the labels to come through, then releases it.
 *
 * Tauri's WebView protocol isn't a secure context, so `navigator.mediaDevices`
 * is undefined there. The native shell owns audio capture via cpal in Rust, so
 * the picker is a no-op on native — we return empty lists rather than throwing
 * so the Settings UI can render its own "uses system defaults" notice.
 */

import { isTauri } from '../voice/native-voice-bridge';

export class MediaUnavailableError extends Error {
	constructor(message = 'Media devices are unavailable in this context (HTTPS or localhost required)') {
		super(message);
	}
}

/** True when device enumeration / picking is meaningful in this build. */
export function isMediaPickingSupported(): boolean {
	if (isTauri()) return false;
	return !!navigator.mediaDevices?.enumerateDevices;
}

export interface DeviceLists {
	mics: MediaDeviceInfo[];
	cameras: MediaDeviceInfo[];
	speakers: MediaDeviceInfo[];
}

export async function enumerateMediaDevices(): Promise<DeviceLists> {
	if (isTauri()) return { mics: [], cameras: [], speakers: [] };
	if (!navigator.mediaDevices?.enumerateDevices) {
		throw new MediaUnavailableError();
	}
	const all = await navigator.mediaDevices.enumerateDevices();
	return {
		mics: all.filter((d) => d.kind === 'audioinput'),
		cameras: all.filter((d) => d.kind === 'videoinput'),
		speakers: all.filter((d) => d.kind === 'audiooutput')
	};
}

/**
 * Opens a short-lived `getUserMedia` stream to unlock device labels.
 * Requests both audio and video to cover camera+mic listings. Partial
 * grants are fine — we just need *one* to populate labels for its kind.
 */
export async function primeDevicePermissions(): Promise<{ audio: boolean; video: boolean }> {
	if (isTauri()) return { audio: false, video: false };
	if (!navigator.mediaDevices?.getUserMedia) throw new MediaUnavailableError();

	let audio = false;
	let video = false;

	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
		audio = true;
		video = true;
		stream.getTracks().forEach((t) => t.stop());
		return { audio, video };
	} catch {
		// Fall through — try audio-only and video-only separately
	}

	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		audio = true;
		stream.getTracks().forEach((t) => t.stop());
	} catch { /* ignored */ }

	try {
		const stream = await navigator.mediaDevices.getUserMedia({ video: true });
		video = true;
		stream.getTracks().forEach((t) => t.stop());
	} catch { /* ignored */ }

	return { audio, video };
}

/** Returns true if `HTMLMediaElement.setSinkId` is supported (Chrome, Edge). */
export function supportsSinkId(): boolean {
	return typeof (HTMLMediaElement.prototype as any).setSinkId === 'function';
}

/**
 * Calls `setSinkId` on the element if supported. No-op on browsers without it.
 */
export async function setAudioOutput(el: HTMLMediaElement, deviceId: string | undefined): Promise<void> {
	if (!supportsSinkId() || !deviceId) return;
	await (el as any).setSinkId(deviceId);
}

/**
 * Subscribe to device-list changes. Returns an unsubscribe function.
 */
export function onDeviceChange(cb: () => void): () => void {
	if (isTauri() || !navigator.mediaDevices) return () => {};
	navigator.mediaDevices.addEventListener('devicechange', cb);
	return () => navigator.mediaDevices.removeEventListener('devicechange', cb);
}
