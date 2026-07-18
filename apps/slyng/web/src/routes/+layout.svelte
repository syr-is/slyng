<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@slyng/ui/sonner';
	import * as Tooltip from '@slyng/ui/tooltip';

	let { children } = $props();

	// Tear down the pre-hydration loading placeholder painted by `app.html`.
	// It sits as a sibling of `%sveltekit.body%` and SvelteKit's hydration
	// only reconciles nodes inside its mount target, so without this it
	// would keep covering the real UI forever. Removing it from the root
	// layout's onMount fires the moment SvelteKit takes over rendering, so
	// the user transitions from inline "Loading…" to the themed chrome
	// (which paints its own "Loading…" inside the (app) layout) in one
	// frame.
	onMount(() => {
		document.getElementById('slyng-boot-fallback')?.remove();
	});
</script>

<svelte:head>
	<title>Slyng</title>
	<meta name="description" content="Slyng - A syr-based chat application" />
</svelte:head>

<ModeWatcher />
<Toaster />
<Tooltip.Provider>
	<!-- Full dynamic viewport height + flex column so the (app) layout's
	     `min-h-0 flex-1` chain has something to stretch into; without this
	     the SwipeLayout panes only render to their intrinsic content height
	     and the rest of the window is empty.

	     Safe-area shell, mirroring native/+layout.svelte: with
	     `viewport-fit=cover` in app.html the page extends under the iOS
	     home indicator / notch (especially in installed-PWA standalone
	     mode), so the shell consumes all four `env(safe-area-inset-*)`
	     values. `--slyng-sai-*` is native's injection channel — unset on
	     web, so the `env()` fallback resolves; on desktop everything is 0
	     and this is a no-op.

	     The inner wrapper zeroes the `--slyng-sai-*` vars for in-flow
	     descendants: the shell has already consumed the insets, so nested
	     consumers must resolve to 0 instead of double-padding. Portalled
	     overlays (sheets, dialogs) escape to <body> and still see the raw
	     values.

	     `--slyng-sai-bottom-captured` snapshots the resolved bottom inset
	     BEFORE the zeroing scope (custom properties substitute var()/env()
	     at computed-value time on the element that declares them, so
	     descendants inherit the resolved length even after the raw var is
	     zeroed). The bottom nav uses it to paint the inset strip below the
	     bar in the bar's own surface color instead of the page background —
	     read-only, so routes without the bar (login) are unaffected. -->
	<div
		class="flex h-dvh flex-col pt-[var(--slyng-sai-top,env(safe-area-inset-top,0px))] pr-[var(--slyng-sai-right,env(safe-area-inset-right,0px))] pb-[var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))] pl-[var(--slyng-sai-left,env(safe-area-inset-left,0px))] [--slyng-sai-bottom-captured:var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))]"
	>
		<div
			class="flex min-h-0 flex-1 flex-col [--slyng-sai-bottom:0px] [--slyng-sai-left:0px] [--slyng-sai-right:0px] [--slyng-sai-top:0px]"
		>
			{@render children()}
		</div>
	</div>
</Tooltip.Provider>
