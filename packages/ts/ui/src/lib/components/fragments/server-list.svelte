<script lang="ts">
	import { MessageSquare, Plus } from '@lucide/svelte';
	import * as Tooltip from '@syren/ui/tooltip';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const { onCreateServer }: { onCreateServer: () => void } = $props();
	const state = getServerState();
</script>

<div class="flex h-full w-[72px] flex-col items-center gap-2 overflow-y-auto bg-background py-3">
	<!-- Home / DMs -->
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<a
					href="/channels/@me"
					{...props}
					class="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground transition-all hover:rounded-xl hover:bg-primary hover:text-primary-foreground"
				>
					<MessageSquare class="h-5 w-5" />
				</a>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">Direct Messages</Tooltip.Content>
	</Tooltip.Root>

	<div class="mx-auto h-[2px] w-8 rounded-full bg-border"></div>

	<!-- Server icons. -->
	{#each state.servers as server (server.id)}
		{@const name = server.name ?? ''}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					{@const isActive = state.activeServerId === server.id}
					<a
						href="/channels/{encodeURIComponent(server.id)}"
						{...props}
						class="group/srv flex h-12 w-12 items-center justify-center overflow-hidden bg-muted text-sm font-semibold text-foreground transition-all hover:rounded-xl hover:bg-primary hover:text-primary-foreground {isActive
							? 'rounded-xl bg-primary text-primary-foreground'
							: 'rounded-2xl'}"
					>
						{#if server.icon_url}
							<img
								src={proxied(server.icon_url)}
								alt={name}
								class="h-12 w-12 object-cover transition-all {isActive
									? 'rounded-xl'
									: 'rounded-2xl group-hover/srv:rounded-xl'}"
							/>
						{:else}
							{name.slice(0, 2).toUpperCase() || '??'}
						{/if}
					</a>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{name || 'Server'}</Tooltip.Content>
		</Tooltip.Root>
	{/each}

	{#if state.servers.length > 0}
		<div class="mx-auto h-[2px] w-8 rounded-full bg-border"></div>
	{/if}

	<!-- Add server -->
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					onclick={onCreateServer}
					class="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-green-500 transition-all hover:rounded-xl hover:bg-green-500 hover:text-white"
				>
					<Plus class="h-5 w-5" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">Add a Server</Tooltip.Content>
	</Tooltip.Root>
</div>
