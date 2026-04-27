import { redirect } from '@sveltejs/kit';
import { setHost } from '@syren/app-core/host';
import { setApi } from '@syren/app-core/api';
import { setRealtime } from '@syren/app-core/realtime';
import { getStoredHost, getStoredHostSync } from '$lib/host-store';
import { createNativeApi } from '$lib/native-api';
import { createNativeRealtime } from '$lib/native-realtime';

export const ssr = false;
export const prerender = false;

let wiredHost: string | null = null;

/**
 * Wire the singleton native api + WS token provider for `host`. The
 * native api is a Tauri-IPC `SyrenClient` impl; no WASM is loaded.
 * Bearer tokens live in the Tauri Store on the Rust side; we surface
 * them to the JS WebSocket layer via the `session_token` command so
 * the gateway's `IDENTIFY` frame carries the right value.
 */
function ensureApi(host: string) {
	if (wiredHost === host) return;
	setApi(createNativeApi(host));
	setRealtime(createNativeRealtime(host));
	wiredHost = host;
}

export const load = async ({ url }: { url: URL }) => {
	let host = getStoredHostSync();

	if (!host) {
		try {
			host = await getStoredHost();
		} catch {
			/* falls through to /setup */
		}
	}

	if (host) {
		setHost(host);
		ensureApi(host);
	} else if (url.pathname !== '/setup') {
		throw redirect(307, `/setup?return=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { host };
};
