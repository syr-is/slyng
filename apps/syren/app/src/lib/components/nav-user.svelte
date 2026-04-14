<script lang="ts">
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Settings from '@lucide/svelte/icons/settings';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { goto } from '$app/navigation';
	import * as Avatar from '@syren/ui/avatar';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { Button } from '@syren/ui/button';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { proxied } from '$lib/utils/proxy';
	import { getPresenceData } from '$lib/stores/presence.svelte';
	import StatusPicker from './status-picker.svelte';

	const {
		did,
		syrInstanceUrl,
		handleSignOut,
		toggleTheme
	}: {
		did: string;
		syrInstanceUrl?: string;
		handleSignOut: () => void | Promise<void>;
		toggleTheme: () => void;
	} = $props();

	const profile = $derived(resolveProfile(did, syrInstanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));
	const avatar = $derived(profile.avatar_url);

	const presence = $derived(getPresenceData(did));
	const statusColor = $derived(
		{
			online: 'bg-green-500',
			idle: 'bg-yellow-500',
			dnd: 'bg-red-500',
			invisible: 'bg-gray-400',
			offline: 'bg-gray-400'
		}[presence.status]
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent"
	>
		<div class="relative">
			<Avatar.Root class="h-8 w-8 rounded-lg">
				<Avatar.Image src={proxied(avatar)} alt={name} />
				<Avatar.Fallback class="rounded-lg">
					{name.slice(0, 2).toUpperCase()}
				</Avatar.Fallback>
			</Avatar.Root>
			<span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar {statusColor}"></span>
		</div>
		<div class="grid flex-1 text-left text-sm leading-tight">
			<span class="truncate font-semibold">{name}</span>
			{#if presence.custom_status || presence.custom_emoji}
				<span class="truncate text-xs text-muted-foreground">
					{presence.custom_emoji ?? ''}
					{presence.custom_status ?? ''}
				</span>
			{:else}
				<span class="truncate font-mono text-xs text-muted-foreground">{handle}</span>
			{/if}
		</div>
		<ChevronsUpDown class="ml-auto size-4 text-muted-foreground" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-56" align="start" sideOffset={4}>
		<DropdownMenu.Label class="p-0 font-normal">
			<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
				<Avatar.Root class="h-8 w-8 rounded-lg">
					<Avatar.Image src={proxied(avatar)} alt={name} />
					<Avatar.Fallback class="rounded-lg">
						{name.slice(0, 2).toUpperCase()}
					</Avatar.Fallback>
				</Avatar.Root>
				<div class="grid flex-1 text-left text-sm leading-tight">
					<span class="truncate font-semibold">{name}</span>
					<span class="truncate font-mono text-xs text-muted-foreground">{handle}</span>
				</div>
				<Button onclick={toggleTheme} variant="ghost" size="icon" class="h-6 w-6">
					<Sun class="h-4 w-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
					<Moon
						class="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
					/>
					<span class="sr-only">Toggle theme</span>
				</Button>
			</div>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<StatusPicker {did} />
		<DropdownMenu.Separator />
		<DropdownMenu.Item onclick={() => goto('/settings')}>
			<Settings />
			Settings
		</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => handleSignOut()}>
			<LogOut />
			Sign Out
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
