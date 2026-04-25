<script lang="ts">
	import { onMount } from 'svelte';

	let viewport = $state({ w: 0, h: 0, dpr: 0 });
	let screenInfo = $state({ w: 0, h: 0 });
	let mobile = $state<boolean | null>(null);
	let injected = $state({ top: '', right: '', bottom: '', left: '' });
	let envMeasured = $state({ top: 0, right: 0, bottom: 0, left: 0 });
	let ua = $state('');

	let probe: HTMLDivElement;

	function refresh() {
		viewport = {
			w: window.innerWidth,
			h: window.innerHeight,
			dpr: window.devicePixelRatio
		};
		screenInfo = { w: window.screen.width, h: window.screen.height };
		mobile = window.matchMedia('(max-width: 767px)').matches;
		const cs = getComputedStyle(document.documentElement);
		injected = {
			top: cs.getPropertyValue('--syren-sai-top').trim() || '(unset)',
			right: cs.getPropertyValue('--syren-sai-right').trim() || '(unset)',
			bottom: cs.getPropertyValue('--syren-sai-bottom').trim() || '(unset)',
			left: cs.getPropertyValue('--syren-sai-left').trim() || '(unset)'
		};
		if (probe) {
			const probeStyle = getComputedStyle(probe);
			envMeasured = {
				top: parseFloat(probeStyle.paddingTop) || 0,
				right: parseFloat(probeStyle.paddingRight) || 0,
				bottom: parseFloat(probeStyle.paddingBottom) || 0,
				left: parseFloat(probeStyle.paddingLeft) || 0
			};
		}
		ua = navigator.userAgent;
	}

	onMount(() => {
		refresh();
		const id = setInterval(refresh, 1000);
		window.addEventListener('resize', refresh);
		return () => {
			clearInterval(id);
			window.removeEventListener('resize', refresh);
		};
	});
</script>

<!-- Hidden probe element to read the resolved env() values via padding. -->
<div
	bind:this={probe}
	style="position:absolute; width:0; height:0; visibility:hidden; padding-top:env(safe-area-inset-top,0px); padding-right:env(safe-area-inset-right,0px); padding-bottom:env(safe-area-inset-bottom,0px); padding-left:env(safe-area-inset-left,0px);"
></div>

<div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-background p-4 text-foreground">
	<h1 class="text-lg font-semibold">Native debug</h1>

	<section class="rounded-md border border-border p-3 text-xs">
		<h2 class="mb-1 font-semibold text-sm">Viewport</h2>
		<pre class="font-mono">window.innerWidth × innerHeight = {viewport.w} × {viewport.h}
window.devicePixelRatio        = {viewport.dpr}
screen.width × screen.height   = {screenInfo.w} × {screenInfo.h}
matchMedia('(max-width: 767px)') = {mobile}</pre>
	</section>

	<section class="rounded-md border border-border p-3 text-xs">
		<h2 class="mb-1 font-semibold text-sm">Native-injected (--syren-sai-*)</h2>
		<pre class="font-mono">--syren-sai-top    = {injected.top}
--syren-sai-right  = {injected.right}
--syren-sai-bottom = {injected.bottom}
--syren-sai-left   = {injected.left}</pre>
		<p class="mt-2 text-muted-foreground">
			On Android these come from MainActivity.kt's WindowInsets listener. If they show
			<code>(unset)</code>, the listener never fired or the APK doesn't include the latest
			MainActivity — rebuild via <code>tauri android dev</code>.
		</p>
	</section>

	<section class="rounded-md border border-border p-3 text-xs">
		<h2 class="mb-1 font-semibold text-sm">env(safe-area-inset-*) resolved</h2>
		<pre class="font-mono">env(top)    = {envMeasured.top}px
env(right)  = {envMeasured.right}px
env(bottom) = {envMeasured.bottom}px
env(left)   = {envMeasured.left}px</pre>
		<p class="mt-2 text-muted-foreground">
			What the WebView itself reports. Tauri Android frequently returns 0 here even with
			<code>viewport-fit=cover</code> + <code>enableEdgeToEdge()</code>; that's why we layer
			the native injection on top.
		</p>
	</section>

	<section class="rounded-md border border-border p-3 text-xs">
		<h2 class="mb-1 font-semibold text-sm">User agent</h2>
		<pre class="font-mono break-all whitespace-pre-wrap">{ua}</pre>
	</section>
</div>
