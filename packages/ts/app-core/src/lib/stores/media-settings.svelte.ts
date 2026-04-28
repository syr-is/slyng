/**
 * Per-browser A/V preferences persisted to localStorage. Device IDs are
 * browser-scoped (different uuids on different machines/browsers), so
 * syncing through the backend would be misleading. Stored separately from
 * session/auth state because these survive logout too.
 */

const KEY_MIC = 'syren:mic_device_id';
const KEY_CAMERA = 'syren:camera_device_id';
const KEY_CAMERA_FPS = 'syren:camera_fps';
const KEY_SPEAKER = 'syren:speaker_device_id';
const KEY_ECHO = 'syren:echo_cancellation';
const KEY_NOISE = 'syren:noise_suppression';
const KEY_AGC = 'syren:auto_gain_control';
const KEY_NOTIFY = 'syren:desktop_notifications';

function readString(key: string): string | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	const v = localStorage.getItem(key);
	return v == null || v === '' ? undefined : v;
}

function writeString(key: string, value: string | undefined) {
	if (typeof localStorage === 'undefined') return;
	if (value == null) localStorage.removeItem(key);
	else localStorage.setItem(key, value);
}

function readBool(key: string, fallback: boolean): boolean {
	if (typeof localStorage === 'undefined') return fallback;
	const v = localStorage.getItem(key);
	if (v == null) return fallback;
	return v === 'true';
}

function readNumber(key: string): number | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	const v = localStorage.getItem(key);
	if (v == null) return undefined;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : undefined;
}

function writeNumber(key: string, value: number | undefined) {
	if (typeof localStorage === 'undefined') return;
	if (value == null) localStorage.removeItem(key);
	else localStorage.setItem(key, String(value));
}

function writeBool(key: string, value: boolean) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(key, value ? 'true' : 'false');
}

let micDeviceId = $state<string | undefined>(readString(KEY_MIC));
let cameraDeviceId = $state<string | undefined>(readString(KEY_CAMERA));
let cameraFps = $state<number | undefined>(readNumber(KEY_CAMERA_FPS));
let speakerDeviceId = $state<string | undefined>(readString(KEY_SPEAKER));
let echoCancellation = $state<boolean>(readBool(KEY_ECHO, true));
let noiseSuppression = $state<boolean>(readBool(KEY_NOISE, true));
let autoGainControl = $state<boolean>(readBool(KEY_AGC, true));
let desktopNotifications = $state<boolean>(readBool(KEY_NOTIFY, false));

export function getMediaSettings() {
	return {
		get micDeviceId() { return micDeviceId; },
		get cameraDeviceId() { return cameraDeviceId; },
		get cameraFps() { return cameraFps; },
		get speakerDeviceId() { return speakerDeviceId; },
		get echoCancellation() { return echoCancellation; },
		get noiseSuppression() { return noiseSuppression; },
		get autoGainControl() { return autoGainControl; },
		get desktopNotifications() { return desktopNotifications; }
	};
}

export function setMicDeviceId(id: string | undefined) {
	micDeviceId = id;
	writeString(KEY_MIC, id);
}

export function setCameraDeviceId(id: string | undefined) {
	cameraDeviceId = id;
	writeString(KEY_CAMERA, id);
}

export function setCameraFps(fps: number | undefined) {
	cameraFps = fps;
	writeNumber(KEY_CAMERA_FPS, fps);
}

export function setSpeakerDeviceId(id: string | undefined) {
	speakerDeviceId = id;
	writeString(KEY_SPEAKER, id);
}

export function setEchoCancellation(v: boolean) {
	echoCancellation = v;
	writeBool(KEY_ECHO, v);
}

export function setNoiseSuppression(v: boolean) {
	noiseSuppression = v;
	writeBool(KEY_NOISE, v);
}

export function setAutoGainControl(v: boolean) {
	autoGainControl = v;
	writeBool(KEY_AGC, v);
}

export function setDesktopNotifications(v: boolean) {
	desktopNotifications = v;
	writeBool(KEY_NOTIFY, v);
}

/**
 * Build the audio constraints object used by `getUserMedia`, merging the
 * current preferred mic ID with the processing toggles.
 */
export function audioConstraints(): MediaTrackConstraints {
	return {
		deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
		echoCancellation,
		noiseSuppression,
		autoGainControl
	};
}

export function videoConstraints(): MediaTrackConstraints {
	return {
		deviceId: cameraDeviceId ? { exact: cameraDeviceId } : undefined
	};
}
