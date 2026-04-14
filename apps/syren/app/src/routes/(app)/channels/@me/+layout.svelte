<script lang="ts">
	import { toggleMode } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { Separator } from '@syren/ui/separator';
	import * as Avatar from '@syren/ui/avatar';
	import NavUser from '$lib/components/nav-user.svelte';
	import { api } from '$lib/api';
	import { setActiveServer } from '$lib/stores/servers.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';

	let { children } = $props();
	let dmChannels = $state<any[]>([]);
	const auth = getAuth();

	onMount(async () => {
		setActiveServer(null);
		try {
			dmChannels = (await api.users.dmChannels()) as any[];
		} catch { /* */ }
	});

	async function handleSignOut() {
		await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		window.location.href = '/login';
	}
</script>

<div class="flex h-full w-60 flex-col border-r border-border bg-sidebar">
	<div class="flex h-12 items-center border-b border-sidebar-border px-4">
		<span class="text-sm font-semibold text-sidebar-foreground">Direct Messages</span>
	</div>

	<div class="flex-1 overflow-y-auto px-2 py-2">
		{#each dmChannels as channel}
			<a
				href="/channels/@me/{channel.id}"
				class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
			>
				<Avatar.Root class="h-8 w-8">
					<Avatar.Fallback class="text-xs">DM</Avatar.Fallback>
				</Avatar.Root>
				<span class="truncate">Direct Message</span>
			</a>
		{/each}

		{#if dmChannels.length === 0}
			<p class="px-2 py-4 text-xs text-sidebar-foreground/50">No conversations yet</p>
		{/if}
	</div>

	<Separator />
	<div class="p-2">
		<NavUser
			did={auth.identity?.did ?? ''}
			syrInstanceUrl={auth.identity?.syr_instance_url}
			handleSignOut={handleSignOut}
			toggleTheme={toggleMode}
		/>
	</div>
</div>

<div class="flex min-w-0 flex-1 flex-col">
	{@render children?.()}
</div>
