import { redirect } from '@sveltejs/kit';
import { setHost } from '@syren/app-core/host';
import { getStoredHost, getStoredHostSync } from '$lib/host-store';

export const ssr = false;
export const prerender = false;

export const load = async ({ url }: { url: URL }) => {
	// Fast path — synchronous localStorage read. Avoids blocking the
	// initial render on a Tauri IPC roundtrip that can hang briefly
	// right after a cross-origin navigation lands back on the native shell.
	let host = getStoredHostSync();
	console.log('[layout.load] sync host =', host, 'pathname =', url.pathname);

	if (!host) {
		// Fall back to Tauri Store in case localStorage was wiped.
		try {
			host = await getStoredHost();
		} catch (err) {
			console.warn('[layout.load] async getStoredHost failed:', err);
		}
		console.log('[layout.load] async host =', host);
	}

	if (host) {
		setHost(host);
	} else if (url.pathname !== '/setup') {
		console.log('[layout.load] no host, redirecting to /setup');
		throw redirect(307, `/setup?return=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { host };
};
