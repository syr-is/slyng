<script lang="ts">
	import '../app.css';
	import { onMount, onDestroy } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { Toaster } from '@syren/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@syren/ui/tooltip';
	import { setBearerToken } from '@syren/app-core/host';
	import { getStoredHostSync } from '$lib/host-store';

	let { children } = $props();

	// Pull the persisted session token out of Tauri's plugin-store on
	// boot and pass it to `app-core/host.ts`. From this point every
	// fetch issued by the shared `api.ts` automatically carries an
	// `Authorization: Bearer ...` header — that's how the native shell
	// authenticates to the API host (cookies don't survive cross-site
	// fetch from `tauri.localhost` in Android WebView's third-party
	// cookie regime).
	let unlisten: UnlistenFn | undefined;
	onMount(async () => {
		const host = getStoredHostSync();
		if (host) {
			try {
				const token = await invoke<string | null>('get_session_token', { apiHost: host });
				setBearerToken(token ?? null);
			} catch (err) {
				console.warn('[auth-boot] get_session_token failed:', err);
			}
		}
		// Rust emits this whenever the OAuth deep-link round-trip
		// finishes (`{ identity, token }`) or after a logout (`null`).
		unlisten = await listen<{ token: string | null } | null>('auth-changed', (event) => {
			setBearerToken(event.payload?.token ?? null);
		});
	});
	onDestroy(() => unlisten?.());
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
		class="flex min-h-dvh flex-col pt-[var(--syren-sai-top,env(safe-area-inset-top,0px))] pr-[var(--syren-sai-right,env(safe-area-inset-right,0px))] pb-[var(--syren-sai-bottom,env(safe-area-inset-bottom,0px))] pl-[var(--syren-sai-left,env(safe-area-inset-left,0px))]"
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
