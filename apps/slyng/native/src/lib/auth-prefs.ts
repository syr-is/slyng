/**
 * Persistent, non-secret auth preferences for the native app: the last
 * syr instance URL, the last auth method (`syr` | `local`) and the
 * recently used API hosts for /setup. Never stores credentials.
 *
 * Same dual-layer pattern as `host-store.ts`:
 *  - localStorage — synchronous fast path, read at component init so the
 *    login/setup forms render prefilled on first paint.
 *  - Tauri Store plugin (`config.json`) — canonical persistence that
 *    survives webview data wipes. Read asynchronously as a backfill.
 *
 * Writes go to BOTH layers so the localStorage cache stays warm.
 */

const LAST_INSTANCE_KEY = 'lastInstanceUrl';
const LAST_METHOD_KEY = 'lastAuthMethod';
const RECENT_HOSTS_KEY = 'recentApiHosts';
const MAX_RECENT_HOSTS = 5;

export type AuthMethod = 'syr' | 'local';

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
		// Same 3-second timeout rationale as host-store: a hanging IPC
		// call must never block rendering the login form.
		const { Store } = await import('@tauri-apps/plugin-store');
		_store = (await withTimeout(Store.load('config.json'), 3000)) as unknown as MinimalStore;
		return _store;
	} catch (err) {
		console.warn('[auth-prefs] Tauri Store unavailable:', err);
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

function localRead(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function localWrite(key: string, value: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, value);
	} catch {
		/* quota / private mode */
	}
}

async function storeRead(key: string): Promise<string | null> {
	const cached = localRead(key);
	if (cached !== null) return cached;
	const s = await tauriStore();
	if (!s) return null;
	try {
		const v = (await withTimeout(s.get<string>(key), 3000)) ?? null;
		if (v !== null) localWrite(key, v);
		return v;
	} catch (err) {
		console.warn('[auth-prefs] Tauri Store get failed:', err);
		return null;
	}
}

async function storeWrite(key: string, value: string): Promise<void> {
	localWrite(key, value);
	const s = await tauriStore();
	if (!s) return;
	try {
		await s.set(key, value);
		await s.save();
	} catch (err) {
		console.warn('[auth-prefs] Tauri Store save failed:', err);
	}
}

// ── Last-used instance URL + auth method ─────────────────────────────

/** Synchronous read — never blocks. Null if no cached value. */
export function getLastInstanceUrlSync(): string | null {
	return localRead(LAST_INSTANCE_KEY);
}

/** Async read — localStorage first, Tauri Store backfill. */
export function getLastInstanceUrl(): Promise<string | null> {
	return storeRead(LAST_INSTANCE_KEY);
}

/** Synchronous read — never blocks. Null if no cached value. */
export function getLastAuthMethodSync(): AuthMethod | null {
	const v = localRead(LAST_METHOD_KEY);
	return v === 'syr' || v === 'local' ? v : null;
}

/** Async read — localStorage first, Tauri Store backfill. */
export async function getLastAuthMethod(): Promise<AuthMethod | null> {
	const v = await storeRead(LAST_METHOD_KEY);
	return v === 'syr' || v === 'local' ? v : null;
}

/**
 * Record a successful sign-in so the next login visit preselects the
 * tab and prefills the instance field. Only host + method — never a
 * password or token.
 */
export async function rememberAuth(method: AuthMethod, instanceUrl?: string): Promise<void> {
	await storeWrite(LAST_METHOD_KEY, method);
	if (instanceUrl) await storeWrite(LAST_INSTANCE_KEY, instanceUrl);
}

// ── Recently used API hosts (/setup) ─────────────────────────────────

function parseHosts(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((h): h is string => typeof h === 'string' && h.length > 0);
	} catch {
		return [];
	}
}

/** Synchronous read — never blocks. Empty array if no cached value. */
export function getRecentHostsSync(): string[] {
	return parseHosts(localRead(RECENT_HOSTS_KEY));
}

/** Async read — localStorage first, Tauri Store backfill. */
export async function getRecentHosts(): Promise<string[]> {
	return parseHosts(await storeRead(RECENT_HOSTS_KEY));
}

/** Push a host to the front of the recents list (deduped, capped). */
export async function addRecentHost(url: string): Promise<string[]> {
	const merged = [url, ...(await getRecentHosts()).filter((h) => h !== url)].slice(
		0,
		MAX_RECENT_HOSTS
	);
	await storeWrite(RECENT_HOSTS_KEY, JSON.stringify(merged));
	return merged;
}
