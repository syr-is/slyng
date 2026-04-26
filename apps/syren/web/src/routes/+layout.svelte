<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@syren/ui/sonner';
	import * as Tooltip from '@syren/ui/tooltip';
	import { apiUrl, setApiTransport, type ApiTransport } from '@syren/app-core/host';
	import { setWsTokenProvider } from '@syren/app-core/stores/ws.svelte';

	let { children } = $props();

	// Bearer auth, web edition. The session id was stashed in
	// `localStorage[syren_session]` by `+layout.ts` when it traded the
	// OAuth bridge code. Every API call adds it as `Authorization:
	// Bearer …`; the gateway already accepts both bearer + cookie
	// (auth.controller.ts:42-49) so the cookie remains as a fallback
	// while we transition off it.
	const SESSION_KEY = 'syren_session';
	function bearerToken(): string | null {
		if (typeof localStorage === 'undefined') return null;
		return localStorage.getItem(SESSION_KEY);
	}

	const transport: ApiTransport = async (path, options) => {
		const token = bearerToken();
		const res = await fetch(apiUrl(path), {
			method: options.method ?? 'GET',
			// Cookie is still sent so an old session that hasn't been
			// migrated to localStorage yet keeps working until the next
			// login round-trip. Once everyone is on bearer this can drop.
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({ message: res.statusText }))) as {
				message?: string;
			};
			throw new Error(err.message || `Request failed: ${res.status}`);
		}
		// Wipe the local session as soon as the server confirms logout
		// — the gateway has invalidated the id by now and the cookie is
		// cleared in the same response.
		if (
			(options.method ?? 'GET').toUpperCase() === 'POST' &&
			path === '/auth/logout' &&
			typeof localStorage !== 'undefined'
		) {
			localStorage.removeItem(SESSION_KEY);
		}
		if (res.status === 204) return undefined as never;
		return res.json();
	};
	setApiTransport(transport);

	// WS auth: same path as native — gateway sees an explicit IDENTIFY
	// frame with the session token instead of relying on the cookie on
	// the WS upgrade. Lets the WS connection survive even if cookies
	// are later disabled or partitioned.
	setWsTokenProvider(async () => bearerToken());
</script>

<svelte:head>
	<title>Syren</title>
	<meta name="description" content="Syren - A syr-based chat application" />
</svelte:head>

<ModeWatcher />
<Toaster />
<Tooltip.Provider>
	{@render children()}
</Tooltip.Provider>
