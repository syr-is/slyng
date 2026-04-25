<script lang="ts">
	import '../app.css';
	import { Toaster } from '@syren/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@syren/ui/tooltip';

	let { children } = $props();
</script>

<ModeWatcher />
<Tooltip.Provider>
	<div class="app-shell">
		{@render children?.()}
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />

<style>
	/* Hard-bake the safe-area insets at the layout root so every screen
	 * — setup, login, the chat tree — sits inside the visible region.
	 * Combined with the `h-screen` / `min-h-screen` overrides in app.css
	 * (which subtract the same insets) full-viewport children fit exactly. */
	.app-shell {
		position: fixed;
		inset: 0;
		padding-top: env(safe-area-inset-top);
		padding-right: env(safe-area-inset-right);
		padding-bottom: env(safe-area-inset-bottom);
		padding-left: env(safe-area-inset-left);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
	}
	.app-shell > :global(*) {
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
	}
</style>
