<script lang="ts">
	import { type Snippet } from 'svelte';
	import { Menu, Users, ChevronRight } from '@lucide/svelte';
	import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
	import { IsMobile } from '../../ui/sidebar/is-mobile.svelte.js';

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

	// Use the same `IsMobile` primitive the sidebar / syner relies on —
	// straight `(max-width: <breakpoint - 1>px)` matchMedia, no pointer
	// quirks. Anything wider stays in the static three-pane desktop view.
	const isMobile = new IsMobile(desktopMinPx);
	const isDesktop = $derived(!isMobile.current);

	function onSwipe(event: SwipeCustomEvent) {
		console.log('[swipe-layout] onSwipe direction =', event.detail.direction, 'isDesktop =', isDesktop, 'pane =', pane);
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

	function openDrawer() {
		if (pane === 'main') pane = 'left';
	}

	function openMembers() {
		if (pane === 'main') pane = 'right';
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
			style="width: calc(312px + 100vw{members ? ' + 100vw' : ''}); transform: translateX({pane === 'left' ? '0px' : pane === 'right' && members ? 'calc(-312px - 100vw)' : '-312px'});"
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
				<!-- Always-visible hamburger fallback so drawer access doesn't
				     depend on edge-swipe gesture exclusion working perfectly
				     (Android `systemGestureExclusionRects` has been spotty in
				     practice). Sits in the top-left corner; pages whose own
				     headers hug the left edge can hide their first icon if
				     they choose. -->
				{#if pane === 'main' && (rail || sidebar)}
					<button
						type="button"
						aria-label="Open menu"
						class="absolute left-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-md bg-background/85 text-foreground shadow-md ring-1 ring-border backdrop-blur-sm hover:bg-background"
						onclick={openDrawer}
					>
						<Menu class="h-4 w-4" />
					</button>
				{/if}
				{#if pane === 'main' && members}
					<button
						type="button"
						aria-label="Open members"
						class="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-md bg-background/85 text-foreground shadow-md ring-1 ring-border backdrop-blur-sm hover:bg-background"
						onclick={openMembers}
					>
						<Users class="h-4 w-4" />
					</button>
				{/if}
			</div>
			<!-- Right drawer: full viewport. Tap-outside dismissal (the
			     `pane !== 'main'` overlay rendered on the main pane) is
			     off-screen when pane === 'right' (main is at -100vw), so
			     surface a close button on the right pane itself. Sits on
			     top of MemberList's content; only visible when open. -->
			{#if members}
				<div class="relative h-full w-screen shrink-0">
					{@render members()}
					{#if pane === 'right'}
						<button
							type="button"
							aria-label="Close members"
							class="absolute left-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-md bg-background/85 text-foreground shadow-md ring-1 ring-border backdrop-blur-sm hover:bg-background"
							onclick={() => (pane = 'main')}
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}
