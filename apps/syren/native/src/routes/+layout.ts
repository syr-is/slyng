import { redirect } from '@sveltejs/kit';
import { setHost } from '@syren/app-core/host';
import { setApi } from '@syren/app-core/api';
import { setWsTokenProvider } from '@syren/app-core/stores/ws.svelte';
import { initSyrenClient, type SyrenClient } from '@syren/client';
import { getStoredHost, getStoredHostSync } from '$lib/host-store';
import { syncSessionFromTauri } from '$lib/session-bridge';

export const ssr = false;
export const prerender = false;

const SESSION_KEY = 'syren_session';
let client: SyrenClient | null = null;
let wiredHost: string | null = null;

/**
 * Wire the singleton WASM client + bearer-bearing WS token provider.
 * Re-init if the user changes API host on /setup — different baseUrl
 * means a different `Client` instance.
 */
async function ensureClient(host: string): Promise<SyrenClient> {
	if (client && wiredHost === host) return client;
	// Release the prior WASM Client (different `wiredHost`) before
	// replacing it — wasm-bindgen allocations don't get reclaimed when
	// the JS reference goes out of scope.
	const prev = client;
	const c = await initSyrenClient(host, { sessionKey: SESSION_KEY });
	setApi(c);
	setWsTokenProvider(async () =>
		typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null
	);
	client = c;
	wiredHost = host;
	prev?.dispose();
	return c;
}

export const load = async ({ url }: { url: URL }) => {
	// Fast path — synchronous localStorage read. Avoids blocking the
	// initial render on a Tauri IPC roundtrip that can hang briefly
	// right after a cross-origin navigation lands back on the native shell.
	let host = getStoredHostSync();

	if (!host) {
		// Fall back to Tauri Store in case localStorage was wiped.
		try {
			host = await getStoredHost();
		} catch {
			/* no store → falls through to /setup */
		}
	}

	if (host) {
		setHost(host);
		// Mirror any persisted session from the Tauri Store into
		// localStorage *before* spinning up the WASM client — its
		// LocalStorageStore is what api.auth.me() reads from. Without
		// this, restarting the app after a previous successful login
		// leaves the WASM client unauthenticated and bounces the user
		// back to /login despite the session still being on disk.
		await syncSessionFromTauri(host);
		await ensureClient(host);
	} else if (url.pathname !== '/setup') {
		throw redirect(307, `/setup?return=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { host };
};
