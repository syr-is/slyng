<script lang="ts">
	import '../app.css';
	import { Toaster } from '@syren/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@syren/ui/tooltip';

	let { children } = $props();
</script>

<ModeWatcher />
<Tooltip.Provider>
	<!-- Safe-area shell — mirrors the pattern in apps/syner. `viewport-fit=cover`
	     in app.html unlocks the env values; on desktop they resolve to 0. -->
	<div
		class="flex min-h-dvh flex-col pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]"
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
