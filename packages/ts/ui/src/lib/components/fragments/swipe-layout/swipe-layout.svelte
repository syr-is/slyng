<script lang="ts">
	import { type Snippet } from 'svelte';
	import { IsMobile } from '../../ui/sidebar/is-mobile.svelte.js';
	import { getPaneState, setPane, type Pane } from './swipe-pane.svelte.js';

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

	const paneState = getPaneState();
	const pane = $derived(paneState.value);

	// Use the same `IsMobile` primitive the sidebar / syner relies on —
	// straight `(max-width: <breakpoint - 1>px)` matchMedia, no pointer
	// quirks. Anything wider stays in the static three-pane desktop view.
	const isMobile = new IsMobile(desktopMinPx);
	const isDesktop = $derived(!isMobile.current);

	// Swipe detection. Rolled by hand with raw touch events because the
	// pointer-event flow svelte-gestures uses gets cancelled mid-swipe by
	// the WebView's scroll heuristic on mobile (lostpointercapture fires
	// the moment any vertical motion is detected, even slight, and the
	// gesture is dropped). Touch events bubble reliably and let us decide
	// on direction at touchend without arguing with the browser.
	const LEFT_DRAWER_PX = 312; // rail (72) + sidebar (240)
	const RIGHT_DRAWER_PX = 240; // members panel width on mobile
	const MIN_SWIPE_PX = 50;
	const MAX_SWIPE_MS = 500;
	const HORIZONTAL_DOMINANCE = 1.4; // |dx| must be ≥ this × |dy|

	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let touchTracking = false;

	function onTouchStart(e: TouchEvent) {
		if (isDesktop || e.touches.length !== 1) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		touchStartTime = Date.now();
		touchTracking = true;
	}

	function onTouchEnd(e: TouchEvent) {
		if (!touchTracking) return;
		touchTracking = false;
		if (Date.now() - touchStartTime > MAX_SWIPE_MS) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		const absX = Math.abs(dx);
		const absY = Math.abs(dy);
		if (absX < MIN_SWIPE_PX) return;
		if (absX < absY * HORIZONTAL_DOMINANCE) return;

		console.log('[swipe-layout] swipe', dx > 0 ? 'right' : 'left', 'pane=', pane);
		if (dx > 0) {
			// swipe right
			if (pane === 'right') setPane('main');
			else if (pane === 'main') setPane('left');
		} else {
			// swipe left
			if (pane === 'left') setPane('main');
			else if (pane === 'main' && members) setPane('right');
		}
	}

	function onTouchCancel() {
		touchTracking = false;
	}

	function closeDrawer() {
		if (pane !== 'main') setPane('main');
	}

	// Layout maths for the inner-track translateX:
	// children laid out [drawer (312px) | main (100vw) | right (240px)]
	// pane === 'left'  → translate 0       (drawer at viewport-left, main + dim overlay covers the rest)
	// pane === 'main'  → translate -312px  (main fills viewport)
	// pane === 'right' → translate -(312 + 240)px so right drawer ends at viewport-right edge,
	//                    main pane offset (100vw - 240) is still visible behind it for backdrop
	const trackTransform = $derived(
		pane === 'left'
			? '0px'
			: pane === 'right' && members
				? `calc(-${LEFT_DRAWER_PX}px - ${RIGHT_DRAWER_PX}px)`
				: `-${LEFT_DRAWER_PX}px`
	);
	const trackWidth = $derived(
		`calc(${LEFT_DRAWER_PX}px + 100vw${members ? ` + ${RIGHT_DRAWER_PX}px` : ''})`
	);
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
		class="relative h-full w-full overflow-hidden bg-background"
		style="touch-action: pan-y"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
		ontouchcancel={onTouchCancel}
	>
		<div
			class="flex h-full transition-transform duration-200 ease-out will-change-transform"
			style="width: {trackWidth}; transform: translateX({trackTransform});"
		>
			<!-- Left drawer: rail (72px) + sidebar (240px) -->
			<div class="flex h-full w-[312px] shrink-0">
				{#if rail}<div class="h-full w-[72px] shrink-0">{@render rail()}</div>{/if}
				{#if sidebar}<div class="h-full w-[240px] shrink-0">{@render sidebar()}</div>{/if}
			</div>
			<!-- Main pane: full viewport. When a drawer is open, the
			     dim overlay covers the visible portion as a tap-to-close
			     affordance (Discord/Telegram pattern). -->
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
			<!-- Right drawer: 240px wide; main pane stays partially visible
			     to its left and serves as the tap-to-close backdrop. -->
			{#if members}
				<div class="h-full w-[240px] shrink-0">{@render members()}</div>
			{/if}
		</div>
	</div>
{/if}
