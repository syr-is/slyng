<script lang="ts">
	import '../app.css';
	import { Toaster } from '@slyng/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import * as Tooltip from '@slyng/ui/tooltip';

	let { children } = $props();
</script>

<ModeWatcher />
<Tooltip.Provider>
	<!-- Safe-area shell.
	     - `--slyng-sai-*` is set by Kotlin (Android) / Swift (iOS) from
	       WindowInsets / safeAreaInsets — Tauri's WebViews don't reliably
	       resolve `env(safe-area-inset-*)` themselves.
	     - `env(...)` is the fallback used by browsers / desktops that DO
	       resolve it correctly.
	     - On plain desktop everything is 0 → no-op. -->
	<div
		class="flex h-dvh flex-col pt-[var(--slyng-sai-top,env(safe-area-inset-top,0px))] pr-[var(--slyng-sai-right,env(safe-area-inset-right,0px))] pb-[var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))] pl-[var(--slyng-sai-left,env(safe-area-inset-left,0px))]"
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
