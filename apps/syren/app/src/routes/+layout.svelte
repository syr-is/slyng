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
	{@render children()}
</Tooltip.Provider>
