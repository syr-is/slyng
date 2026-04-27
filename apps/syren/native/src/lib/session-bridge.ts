/**
 * Native has two parallel session stores by construction:
 *
 *   1. The Rust OAuth flow (`auth.rs::handle_callback_url`) writes to
 *      the Tauri Store via `tauri-plugin-store`, where it survives app
 *      restarts in the OS-managed app data directory.
 *   2. The JS-side WASM client wired in `+layout.ts` uses
 *      `LocalStorageStore`, which only sees `localStorage`.
 *
 * After a successful OAuth callback the session lives in (1) but the
 * JS api singleton looks in (2), so every `api.auth.me()` call returns
 * 401 and the user is stranded on /login.
 *
 * `syncSessionFromTauri` mirrors (1) → (2) at the points that matter:
 * app boot, post-login (`auth-changed`), and the login page's
 * recovery polling. Bounded to the native shell — no equivalent on web.
 */

import { invoke } from '@tauri-apps/api/core';

const SESSION_KEY = 'syren_session';

export async function syncSessionFromTauri(apiHost: string): Promise<void> {
	try {
		const stored = await invoke<string | null>('session_token', { apiHost });
		if (typeof localStorage === 'undefined') return;
		if (stored) {
			localStorage.setItem(SESSION_KEY, stored);
		} else {
			localStorage.removeItem(SESSION_KEY);
		}
	} catch {
		/* no active client yet, or IPC error — leave localStorage as is */
	}
}
