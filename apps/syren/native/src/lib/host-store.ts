/**
 * Persistent storage for the user-chosen API host on the native app.
 *
 * Two layers:
 *  - localStorage — synchronous, available immediately on every page
 *    load. The fast path used during initial routing.
 *  - Tauri Store plugin (file: `config.json` in the app's data dir) —
 *    canonical persistence that survives webview data wipes. Read
 *    asynchronously and only as a backfill when localStorage is empty.
 *
 * Writes go to BOTH layers so the localStorage cache stays warm.
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
	try {
		// 3-second timeout — a hanging IPC call here would otherwise block
		// the entire SvelteKit load() chain forever and leave the user on
		// a white screen.
		const { Store } = await import('@tauri-apps/plugin-store');
		_store = await withTimeout(Store.load('config.json'), 3000) as unknown as MinimalStore;
		return _store;
	} catch (err) {
		console.warn('[host-store] Tauri Store unavailable:', err);
		return null;
	}
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

/** Synchronous read — never blocks. Returns null if no cached value. */
export function getStoredHostSync(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

/** Async read — checks localStorage first, falls back to Tauri Store. */
export async function getStoredHost(): Promise<string | null> {
	const cached = getStoredHostSync();
	if (cached) return cached;
	const s = await tauriStore();
	if (s) {
		try {
			const v = (await withTimeout(s.get<string>(KEY), 3000)) ?? null;
			if (v && typeof localStorage !== 'undefined') {
				try {
					localStorage.setItem(KEY, v);
				} catch {
					/* quota / private mode */
				}
			}
			return v;
		} catch (err) {
			console.warn('[host-store] Tauri Store get failed:', err);
		}
	}
	return null;
}

export async function setStoredHost(url: string): Promise<void> {
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(KEY, url);
		} catch {
			/* quota / private mode */
		}
	}
	const s = await tauriStore();
	if (s) {
		try {
			await s.set(KEY, url);
			await s.save();
		} catch (err) {
			console.warn('[host-store] Tauri Store save failed:', err);
		}
	}
	setHost(url);
}

export async function clearStoredHost(): Promise<void> {
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.removeItem(KEY);
		} catch {
			/* */
		}
	}
	const s = await tauriStore();
	if (s) {
		try {
			await s.set(KEY, null);
			await s.save();
		} catch {
			/* */
		}
	}
	setHost('');
}
