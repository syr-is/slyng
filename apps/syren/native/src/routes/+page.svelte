<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiUrl } from '@syren/app-core/host';

	let checking = $state(true);

	onMount(async () => {
		try {
			const res = await fetch(apiUrl('/auth/me'), { credentials: 'include' });
			if (res.ok) {
				goto('/channels/@me', { replaceState: true });
				return;
			}
		} catch {
			// fall through to login
		}
		goto('/login', { replaceState: true });
		checking = false;
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-background">
	<p class="text-sm text-muted-foreground">{checking ? 'Connecting…' : 'Redirecting…'}</p>
</div>
