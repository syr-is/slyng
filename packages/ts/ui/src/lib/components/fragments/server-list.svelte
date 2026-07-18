<script lang="ts">
	import { MessageSquare, Plus } from '@lucide/svelte';
	import * as Tooltip from '@slyng/ui/tooltip';
	import { page } from '$app/state';
	import { getServerState } from '@slyng/app-core/stores/servers.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';

	const { onCreateServer }: { onCreateServer: () => void } = $props();
	const state = getServerState();

	const onDmSection = $derived(page.url.pathname.startsWith('/channels/@me'));
</script>

{#snippet indicatorPill(active: boolean)}
	<!-- Selected-item indicator (the Discord-proven pattern): tall pill on
	     the active item, short pill on hover. Always in the DOM so state
	     changes animate transform/opacity only — never height/layout. -->
	<span
		aria-hidden="true"
		class="absolute top-1/2 left-0 h-10 w-1 origin-center -translate-y-1/2 rounded-r-full bg-foreground motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out {active
			? 'scale-y-100 opacity-100'
			: 'scale-y-[0.3] opacity-0 group-hover/srv:opacity-100'}"
	></span>
{/snippet}

<div
	class="flex h-full w-[72px] flex-col items-center gap-2 overflow-y-auto border-r border-border bg-sidebar py-3"
>
	<!-- Home / DMs -->
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<div class="group/srv relative flex w-full shrink-0 justify-center">
					{@render indicatorPill(onDmSection)}
					<a
						href="/channels/@me"
						{...props}
						class="flex h-12 w-12 items-center justify-center transition-all motion-safe:active:scale-95 {onDmSection
							? 'rounded-xl bg-primary text-primary-foreground'
							: 'rounded-2xl bg-muted text-foreground hover:rounded-xl hover:bg-primary/20'}"
					>
						<MessageSquare class="h-5 w-5" />
					</a>
				</div>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">Direct Messages</Tooltip.Content>
	</Tooltip.Root>

	<div class="mx-auto h-[2px] w-8 shrink-0 rounded-full bg-border"></div>

	<!-- Server icons. Active item differs from every other state by two
	     simultaneous cues (full primary fill + indicator pill); hover on a
	     non-active item is a shape morph + 20% tint, never the full fill. -->
	{#each state.servers as server (server.id)}
		{@const name = server.name ?? ''}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					{@const isActive = state.activeServerId === server.id}
					<div class="group/srv relative flex w-full shrink-0 justify-center">
						{@render indicatorPill(isActive)}
						<a
							href="/channels/{encodeURIComponent(server.id)}"
							{...props}
							aria-current={isActive ? 'page' : undefined}
							class="flex h-12 w-12 items-center justify-center overflow-hidden text-sm font-semibold transition-all motion-safe:active:scale-95 {isActive
								? 'rounded-xl bg-primary text-primary-foreground'
								: 'rounded-2xl bg-muted text-foreground hover:rounded-xl hover:bg-primary/20'}"
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
					</div>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right">{name || 'Server'}</Tooltip.Content>
		</Tooltip.Root>
	{/each}

	{#if state.servers.length > 0}
		<div class="mx-auto h-[2px] w-8 shrink-0 rounded-full bg-border"></div>
	{/if}

	<!-- Add server -->
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					onclick={onCreateServer}
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-green-500 transition-all hover:rounded-xl hover:bg-green-500 hover:text-white motion-safe:active:scale-95"
				>
					<Plus class="h-5 w-5" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="right">Add a Server</Tooltip.Content>
	</Tooltip.Root>
</div>
