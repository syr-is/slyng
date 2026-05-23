<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@syren/ui/sonner';
	import * as Tooltip from '@syren/ui/tooltip';

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
		document.getElementById('syren-boot-fallback')?.remove();
	});
</script>

<svelte:head>
	<title>Syren</title>
	<meta name="description" content="Syren - A syr-based chat application" />
</svelte:head>

<ModeWatcher />
<Toaster />
<Tooltip.Provider>
	<!-- Full dynamic viewport height + flex column so the (app) layout's
	     `min-h-0 flex-1` chain has something to stretch into. Native
	     wraps the same way (plus safe-area insets, which web doesn't
	     need); without this the SwipeLayout panes only render to their
	     intrinsic content height and the rest of the window is empty. -->
	<div class="flex h-dvh flex-col">
		{@render children()}
	</div>
</Tooltip.Provider>
