<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getStoredHostSync } from '$lib/host-store';
	import { getNativeClient } from '$lib/client';

	let checking = $state(true);

	onMount(async () => {
		const host = getStoredHostSync();
		if (!host) {
			goto('/setup', { replaceState: true });
			return;
		}
		try {
			// Goes through Rust `me` command, which uses syren-client's
			// reqwest with the bearer token from tauri-plugin-store.
			await getNativeClient(host).me();
			goto('/channels/@me', { replaceState: true });
			return;
		} catch {
			/* unauth or unreachable — fall through */
		}
		goto('/login', { replaceState: true });
		checking = false;
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background">
	<p class="text-sm text-muted-foreground">{checking ? 'Connecting…' : 'Redirecting…'}</p>
</div>
