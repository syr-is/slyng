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
	     - On plain desktop everything is 0 → no-op.
	     - The inner wrapper zeroes the vars for in-flow descendants: the
	       shell has already consumed the insets, so nested consumers must
	       resolve to 0 instead of double-padding. Portalled overlays
	       (sheets, dialogs) escape to <body> and still see the raw values.
	     - `--slyng-sai-bottom-captured` snapshots the resolved bottom inset
	       BEFORE the zeroing scope (custom properties substitute var()/env()
	       at computed-value time on the element that declares them, so
	       descendants inherit the resolved length even after the raw var is
	       zeroed). The bottom nav uses it to paint the inset strip below the
	       bar in the bar's own surface color instead of the page background —
	       read-only, so routes without the bar (setup, login) are unaffected. -->
	<div
		class="flex h-dvh flex-col pt-[var(--slyng-sai-top,env(safe-area-inset-top,0px))] pr-[var(--slyng-sai-right,env(safe-area-inset-right,0px))] pb-[var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))] pl-[var(--slyng-sai-left,env(safe-area-inset-left,0px))] [--slyng-sai-bottom-captured:var(--slyng-sai-bottom,env(safe-area-inset-bottom,0px))]"
	>
		<div
			class="flex min-h-0 flex-1 flex-col [--slyng-sai-bottom:0px] [--slyng-sai-left:0px] [--slyng-sai-right:0px] [--slyng-sai-top:0px]"
		>
			{@render children?.()}
		</div>
	</div>
</Tooltip.Provider>
<Toaster richColors position="bottom-right" />
