<script lang="ts">
	import { goto } from '$app/navigation';
	import { checkAuth } from '@syren/app-core/stores/auth.svelte';

	const redirect = checkAuth().then((user) => {
		goto(user ? '/channels/@me' : '/login', { replaceState: true });
	});
</script>

{#await redirect}
	<div class="flex min-h-screen items-center justify-center bg-background">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{/await}
