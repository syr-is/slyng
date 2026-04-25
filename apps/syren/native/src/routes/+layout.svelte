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
	/* Block-level safe-area shell. Flow layout (no position: fixed —
	 * fixed elements interact poorly with the iOS software keyboard).
	 * Combined with the `h-screen` / `min-h-screen` overrides in app.css
	 * (which subtract the same insets) full-viewport children fit exactly.
	 *
	 * Padding is supplied with the `max(...)` guard so we never go below
	 * the constant fallback — useful in WebViews that report 0 for the
	 * env values even though the page does render under the unsafe area. */
	.app-shell {
		min-height: 100dvh;
		padding-top: max(env(safe-area-inset-top), 0px);
		padding-right: max(env(safe-area-inset-right), 0px);
		padding-bottom: max(env(safe-area-inset-bottom), 0px);
		padding-left: max(env(safe-area-inset-left), 0px);
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
