/**
 * Auto-idle detection.
 *
 * Only the 'online' status auto-flips to 'idle' after inactivity. Any other
 * explicit status (dnd, invisible, user-picked idle) is sticky — we never
 * auto-flip away from it, and activity doesn't restore from it.
 *
 * Flow:
 *   - user is 'online' and goes 5 min with no input → we flip them to 'idle'
 *     and remember that WE did it (autoIdle=true)
 *   - activity arrives → if autoIdle, restore to 'online'
 *   - if user explicitly picks 'idle' via the picker, it's NOT autoIdle, so
 *     activity leaves them idle
 *   - if user picks dnd/invisible, onIdle() does nothing (status !== 'online')
 */

import { updateMyPresence, type PresenceStatus } from './presence.svelte';

const IDLE_AFTER_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let autoIdle = false;
let userStatus: PresenceStatus = 'online';

function armTimer() {
	if (timer) clearTimeout(timer);
	timer = setTimeout(onIdle, IDLE_AFTER_MS);
}

function bump() {
	armTimer();
	if (autoIdle) {
		console.log('[idle] activity bump → restoring to', userStatus);
		autoIdle = false;
		updateMyPresence({ status: userStatus });
	}
}

function onIdle() {
	if (userStatus !== 'online' || autoIdle) return;
	console.log('[idle] auto-idle threshold; flipping → idle');
	autoIdle = true;
	updateMyPresence({ status: 'idle' });
}

/** User picked a status via the UI. Sticky — overrides any auto-idle state. */
export function setExplicitStatus(status: PresenceStatus) {
	console.log('[idle] setExplicitStatus →', status);
	userStatus = status;
	autoIdle = false;
	armTimer();
	updateMyPresence({ status });
}

/**
 * Keep the watcher's baseline in sync with whatever the server thinks the
 * user's status is (e.g. restored-from-DB on reconnect, or another tab
 * flipped the status). Ignore echoes of our own auto-idle flip.
 */
export function syncStatus(status: PresenceStatus) {
	if (status === 'idle' && autoIdle) return; // our own echo
	console.log('[idle] syncStatus from server =', status);
	userStatus = status;
	if (status !== 'idle') autoIdle = false;
}

export function startIdleWatcher() {
	if (started || typeof window === 'undefined') return;
	started = true;
	console.log('[idle] startIdleWatcher armed; baseline =', userStatus);
	for (const e of ACTIVITY_EVENTS) {
		window.addEventListener(e, bump, { passive: true });
	}
	armTimer();
}

export function stopIdleWatcher() {
	if (!started) return;
	started = false;
	if (timer) clearTimeout(timer);
	timer = null;
	for (const e of ACTIVITY_EVENTS) {
		window.removeEventListener(e, bump);
	}
}
