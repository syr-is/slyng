import { redirect } from '@sveltejs/kit';
import { invoke } from '@tauri-apps/api/core';
import { setHost } from '@slyng/app-core/host';
import { setApi } from '@slyng/app-core/api';
import { setRealtime } from '@slyng/app-core/realtime';
import { setSessionTokenProvider } from '@slyng/app-core/idp-fetch';
import { getStoredHost, getStoredHostSync } from '$lib/host-store';
import { createNativeApi } from '$lib/native-api';
import { createNativeRealtime } from '$lib/native-realtime';

export const ssr = false;
export const prerender = false;

let wiredHost: string | null = null;

/**
 * Wire the singleton native api + WS token provider for `host`. The
 * native api is a Tauri-IPC `SlyngClient` impl; no WASM is loaded.
 * Bearer tokens live in the Tauri Store on the Rust side; we surface
 * them to the JS WebSocket layer via the `session_token` command so
 * the gateway's `IDENTIFY` frame carries the right value.
 */
function ensureApi(host: string) {
	if (wiredHost === host) return;
	setApi(createNativeApi(host));
	setRealtime(createNativeRealtime(host));
	// IdP surfaces (consent, delegations, authoring) read the session
	// token from the Tauri Store via the same command the WS layer uses.
	setSessionTokenProvider(() => invoke<string | null>('session_token', { apiHost: host }));
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
