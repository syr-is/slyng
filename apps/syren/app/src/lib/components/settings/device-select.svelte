<script lang="ts">
	import { Check, ChevronDown } from '@lucide/svelte';
	import * as DropdownMenu from '@syren/ui/dropdown-menu';
	import { Button } from '@syren/ui/button';

	const {
		devices,
		value,
		onSelect,
		placeholder = 'System default'
	}: {
		devices: MediaDeviceInfo[];
		value: string | undefined;
		onSelect: (id: string | undefined) => void;
		placeholder?: string;
	} = $props();

	const selectedLabel = $derived.by(() => {
		if (!value) return placeholder;
		return devices.find((d) => d.deviceId === value)?.label || placeholder;
	});
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="w-full justify-between">
				<span class="truncate">{selectedLabel}</span>
				<ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-60" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-[--radix-dropdown-menu-trigger-width] min-w-64">
		<DropdownMenu.Item onclick={() => onSelect(undefined)}>
			<span class="flex-1">{placeholder}</span>
			{#if !value}
				<Check class="h-4 w-4" />
			{/if}
		</DropdownMenu.Item>
		{#if devices.length > 0}
			<DropdownMenu.Separator />
		{/if}
		{#each devices as device (device.deviceId)}
			<DropdownMenu.Item onclick={() => onSelect(device.deviceId)}>
				<span class="flex-1 truncate">{device.label || `Device ${device.deviceId.slice(0, 6)}`}</span>
				{#if value === device.deviceId}
					<Check class="h-4 w-4" />
				{/if}
			</DropdownMenu.Item>
		{/each}
		{#if devices.length === 0}
			<DropdownMenu.Item disabled>
				<span class="text-muted-foreground">No devices found</span>
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
