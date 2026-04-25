/**
 * Persistent storage for the user-chosen API host on the native app.
 *
 * Backed by Tauri's Store plugin (file: `config.json` inside the app's
 * data dir). On non-Tauri runtime (e.g. `pnpm dev` in a browser for UI
 * iteration), falls back to localStorage so iteration still works.
 */

import { setHost } from '@syren/app-core/host';

const KEY = 'apiHost';

function inTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface MinimalStore {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	save(): Promise<void>;
}

let _store: MinimalStore | null = null;
async function tauriStore(): Promise<MinimalStore | null> {
	if (!inTauri()) return null;
	if (_store) return _store;
	const { Store } = await import('@tauri-apps/plugin-store');
	_store = (await Store.load('config.json')) as unknown as MinimalStore;
	return _store;
}

export async function getStoredHost(): Promise<string | null> {
	const s = await tauriStore();
	if (s) {
		const v = await s.get<string>(KEY);
		return v ?? null;
	}
	if (typeof localStorage !== 'undefined') return localStorage.getItem(KEY);
	return null;
}

export async function setStoredHost(url: string): Promise<void> {
	const s = await tauriStore();
	if (s) {
		await s.set(KEY, url);
		await s.save();
	} else if (typeof localStorage !== 'undefined') {
		localStorage.setItem(KEY, url);
	}
	setHost(url);
}

export async function clearStoredHost(): Promise<void> {
	const s = await tauriStore();
	if (s) {
		await s.set(KEY, null);
		await s.save();
	} else if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(KEY);
	}
	setHost('');
}
