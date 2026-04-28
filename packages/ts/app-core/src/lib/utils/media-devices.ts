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
 * is undefined there. The native shell owns audio capture via cpal in Rust and
 * exposes its real device lists through Tauri commands; we adapt them into
 * `MediaDeviceInfo`-shaped objects so the existing Settings UI just works.
 */

import {
	isTauri,
	nativeListAudioInputs,
	nativeListAudioOutputs,
	nativeListCameras,
	type NativeDevice
} from '../voice/native-voice-bridge';

export class MediaUnavailableError extends Error {
	constructor(message = 'Media devices are unavailable in this context (HTTPS or localhost required)') {
		super(message);
	}
}

/** True when device enumeration / picking is meaningful in this build. */
export function isMediaPickingSupported(): boolean {
	if (isTauri()) return true;
	return !!navigator.mediaDevices?.enumerateDevices;
}

/**
 * True when changing the audio output device routes through this build.
 * Browsers gate this on `HTMLMediaElement.setSinkId`; Tauri routes
 * playback through cpal so we can always pick.
 */
export function supportsOutputDeviceSelection(): boolean {
	if (isTauri()) return true;
	return supportsSinkId();
}

export interface DeviceLists {
	mics: MediaDeviceInfo[];
	cameras: MediaDeviceInfo[];
	speakers: MediaDeviceInfo[];
}

function adaptNative(d: NativeDevice, kind: MediaDeviceKind): MediaDeviceInfo {
	// `MediaDeviceInfo` is an interface, not a class, so a plain
	// object satisfies it. groupId is empty — cpal/nokhwa don't model
	// device groups and the field is purely informational.
	return {
		deviceId: d.id,
		groupId: '',
		kind,
		label: d.label,
		toJSON() {
			return { deviceId: d.id, groupId: '', kind, label: d.label };
		}
	};
}

export async function enumerateMediaDevices(): Promise<DeviceLists> {
	if (isTauri()) {
		const [mics, speakers, cameras] = await Promise.all([
			nativeListAudioInputs(),
			nativeListAudioOutputs(),
			nativeListCameras()
		]);
		return {
			mics: mics.map((d) => adaptNative(d, 'audioinput')),
			speakers: speakers.map((d) => adaptNative(d, 'audiooutput')),
			cameras: cameras.map((d) => adaptNative(d, 'videoinput'))
		};
	}
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
	// Native: cpal / nokhwa enumerate without OS-permission gating so
	// labels are already populated. Skip the `getUserMedia` priming.
	if (isTauri()) return { audio: true, video: true };
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
