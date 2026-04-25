<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';

	type Pane = 'left' | 'main' | 'right';

	interface Props {
		/** Far-left rail (e.g. ServerList). 72px on mobile. */
		rail?: Snippet;
		/** Channel sidebar. 240px on mobile. Shown together with rail when pane === 'left'. */
		sidebar?: Snippet;
		/** Main content (messages / voice / settings). */
		main: Snippet;
		/** Optional right pane (member list / details). */
		members?: Snippet;
		/** Tailwind breakpoint at which the layout switches to desktop (no swipe). */
		desktopMinPx?: number;
	}

	let { rail, sidebar, main, members, desktopMinPx = 768 }: Props = $props();

	let pane = $state<Pane>('main');

	// Desktop = wide AND fine pointer. A 1024-px iPad in portrait has
	// `pointer: coarse`, so we still give it the mobile drawer UX rather
	// than cramming three panes onto a touch screen.
	function computeDesktop(): boolean {
		if (typeof window === 'undefined') return false;
		const wide = window.matchMedia(`(min-width: ${desktopMinPx}px)`).matches;
		const fine = window.matchMedia('(pointer: fine)').matches;
		return wide && fine;
	}
	let isDesktop = $state(computeDesktop());

	onMount(() => {
		const mqWide = window.matchMedia(`(min-width: ${desktopMinPx}px)`);
		const mqFine = window.matchMedia('(pointer: fine)');
		const update = () => (isDesktop = computeDesktop());
		mqWide.addEventListener('change', update);
		mqFine.addEventListener('change', update);
		return () => {
			mqWide.removeEventListener('change', update);
			mqFine.removeEventListener('change', update);
		};
	});

	function onSwipe(event: SwipeCustomEvent) {
		if (isDesktop) return;
		const dir = event.detail.direction;
		if (dir === 'right') {
			if (pane === 'right') pane = 'main';
			else if (pane === 'main') pane = 'left';
		} else if (dir === 'left') {
			if (pane === 'left') pane = 'main';
			else if (pane === 'main' && members) pane = 'right';
		}
	}

	const swipeAttachment = useSwipe(onSwipe, () => ({
		timeframe: 400,
		minSwipeDistance: 60,
		touchAction: 'pan-y'
	}));

	function closeDrawer() {
		if (pane !== 'main') pane = 'main';
	}
</script>

{#if isDesktop}
	<div class="flex h-full w-full overflow-hidden bg-background">
		{#if rail}<div class="shrink-0">{@render rail()}</div>{/if}
		{#if sidebar}<div class="shrink-0">{@render sidebar()}</div>{/if}
		<div class="min-h-0 min-w-0 flex-1">{@render main()}</div>
		{#if members}<div class="shrink-0">{@render members()}</div>{/if}
	</div>
{:else}
	<div
		{...swipeAttachment}
		class="relative h-full w-full overflow-hidden bg-background"
	>
		<div
			class="flex h-full transition-transform duration-200 ease-out will-change-transform"
			class:translate-x-0={pane === 'left'}
			class:-translate-x-[312px]={pane === 'main'}
			class:-translate-x-[calc(312px+100vw)]={pane === 'right' && !!members}
			style="width: calc(312px + 100vw{members ? ' + 100vw' : ''});"
		>
			<!-- Left drawer: rail (72px) + sidebar (240px) -->
			<div class="flex h-full w-[312px] shrink-0">
				{#if rail}<div class="h-full w-[72px] shrink-0">{@render rail()}</div>{/if}
				{#if sidebar}<div class="h-full w-[240px] shrink-0">{@render sidebar()}</div>{/if}
			</div>
			<!-- Main pane: full viewport -->
			<div class="relative h-full w-screen shrink-0">
				{@render main()}
				{#if pane !== 'main'}
					<button
						type="button"
						aria-label="Close drawer"
						class="absolute inset-0 z-50 bg-background/40"
						onclick={closeDrawer}
					></button>
				{/if}
			</div>
			<!-- Right drawer: full viewport -->
			{#if members}
				<div class="h-full w-screen shrink-0">{@render members()}</div>
			{/if}
		</div>
	</div>
{/if}
