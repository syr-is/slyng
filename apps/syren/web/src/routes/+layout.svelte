<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@syren/ui/sonner';
	import * as Tooltip from '@syren/ui/tooltip';

	let { children } = $props();
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
