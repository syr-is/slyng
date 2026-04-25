<script lang="ts">
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { Smile, Circle } from '@lucide/svelte';
	import { Input } from '@syren/ui/input';
	import { Button } from '@syren/ui/button';
	import { getPresenceData, updateMyPresence, type PresenceStatus } from '@syren/app-core/stores/presence.svelte';
	import { setExplicitStatus } from '@syren/app-core/stores/idle.svelte';

	const { did }: { did: string } = $props();

	const myPresence = $derived(getPresenceData(did));

	const statuses: { value: PresenceStatus; label: string; color: string; description: string }[] = [
		{ value: 'online', label: 'Online', color: 'bg-green-500', description: '' },
		{ value: 'idle', label: 'Idle', color: 'bg-yellow-500', description: 'Away from keyboard' },
		{ value: 'dnd', label: 'Do Not Disturb', color: 'bg-red-500', description: 'Suppress notifications' },
		{ value: 'invisible', label: 'Invisible', color: 'bg-gray-400', description: 'Appear offline to others' }
	];

	let editingCustom = $state(false);
	let customText = $state('');
	let customEmoji = $state('');

	function startEditCustom() {
		customText = myPresence.custom_status ?? '';
		customEmoji = myPresence.custom_emoji ?? '';
		editingCustom = true;
	}

	function saveCustom() {
		updateMyPresence({
			custom_status: customText.trim(),
			custom_emoji: customEmoji.trim()
		});
		editingCustom = false;
	}

	function clearCustom() {
		customText = '';
		customEmoji = '';
		updateMyPresence({ custom_status: '', custom_emoji: '' });
		editingCustom = false;
	}

	function setStatus(value: PresenceStatus) {
		setExplicitStatus(value);
	}
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger>
		<span class="mr-2 inline-block h-2.5 w-2.5 rounded-full {statuses.find((s) => s.value === myPresence.status)?.color ?? 'bg-gray-400'}"></span>
		<span>Set Status</span>
	</DropdownMenu.SubTrigger>
	<DropdownMenu.SubContent class="w-64">
		{#each statuses as s}
			<DropdownMenu.Item onclick={() => setStatus(s.value)}>
				<span class="mr-2 inline-block h-2.5 w-2.5 rounded-full {s.color}"></span>
				<div class="flex flex-col">
					<span class="text-sm">{s.label}</span>
					{#if s.description}
						<span class="text-[11px] text-muted-foreground">{s.description}</span>
					{/if}
				</div>
			</DropdownMenu.Item>
		{/each}

		<DropdownMenu.Separator />

		{#if editingCustom}
			<div class="space-y-2 p-2">
				<div class="flex gap-1">
					<Input bind:value={customEmoji} placeholder="🙂" class="w-12 text-center" maxlength={4} />
					<Input bind:value={customText} placeholder="Custom status..." maxlength={128} />
				</div>
				<div class="flex gap-1">
					<Button size="sm" onclick={saveCustom} class="flex-1">Save</Button>
					<Button size="sm" variant="outline" onclick={() => (editingCustom = false)}>Cancel</Button>
					{#if myPresence.custom_status || myPresence.custom_emoji}
						<Button size="sm" variant="outline" onclick={clearCustom}>Clear</Button>
					{/if}
				</div>
			</div>
		{:else}
			<DropdownMenu.Item onclick={startEditCustom}>
				<Smile class="mr-2 h-4 w-4" />
				{#if myPresence.custom_status || myPresence.custom_emoji}
					<span class="truncate">
						{myPresence.custom_emoji ?? ''}
						{myPresence.custom_status ?? 'Custom status'}
					</span>
				{:else}
					<span>Set custom status</span>
				{/if}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>
