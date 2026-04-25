<script lang="ts">
	import '../app.css';
	import { Toaster } from '@syren/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@syren/ui/tooltip';

	let { children } = $props();
</script>

<ModeWatcher />
<Tooltip.Provider>
	{@render children?.()}
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
