<script lang="ts">
	import '../app.css';
	import { invoke } from '@tauri-apps/api/core';
	import { Toaster } from '@syren/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@syren/ui/tooltip';
	import { setApiTransport, type ApiTransport } from '@syren/app-core/host';
	import { getStoredHostSync } from '$lib/host-store';

	let { children } = $props();

	// Route every API call from the shared `app-core/api.ts` through
	// Rust. The Tauri command `proxy_request` forwards to
	// `syren-client::Client::request_raw`, which uses reqwest with the
	// persistent cookie jar and the session id stored in
	// `tauri-plugin-store`. JS never sees the auth token; there is no
	// second fetch path; the API host is read from the same Tauri
	// store the user picked on the /setup screen.
	async function proxy(
		path: string,
		options: { method?: string; body?: unknown }
	): Promise<unknown> {
		const apiHost = getStoredHostSync();
		if (!apiHost) throw new Error('API host not configured — visit /setup');
		return invoke('proxy_request', {
			apiHost,
			path,
			method: options.method ?? 'GET',
			body: options.body ?? null
		});
	}
	console.log('[+layout root] setApiTransport called; proxy fn type =', typeof proxy);
	setApiTransport(proxy as ApiTransport);
</script>

<ModeWatcher />
<Tooltip.Provider>
	<!-- Safe-area shell.
	     - `--syren-sai-*` is set by Kotlin (Android) / Swift (iOS) from
	       WindowInsets / safeAreaInsets — Tauri's WebViews don't reliably
	       resolve `env(safe-area-inset-*)` themselves.
	     - `env(...)` is the fallback used by browsers / desktops that DO
	       resolve it correctly.
	     - On plain desktop everything is 0 → no-op. -->
	<div
		class="flex h-dvh flex-col pt-[var(--syren-sai-top,env(safe-area-inset-top,0px))] pr-[var(--syren-sai-right,env(safe-area-inset-right,0px))] pb-[var(--syren-sai-bottom,env(safe-area-inset-bottom,0px))] pl-[var(--syren-sai-left,env(safe-area-inset-left,0px))]"
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
