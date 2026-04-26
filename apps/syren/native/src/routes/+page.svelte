<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '@syren/app-core/api';

	let checking = $state(true);

	onMount(async () => {
		try {
			// Wired in `+layout.ts::ensureClient` — calls /auth/me through
			// the WASM client with the bearer token stored under
			// `localStorage[syren_session]`.
			await api.auth.me();
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
