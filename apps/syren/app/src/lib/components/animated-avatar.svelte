<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	/**
	 * Avatar that animates only while `speaking` is true. For animated image
	 * formats (gif/apng/webp) we can't pause the `<img>` element itself, so we
	 * render the source off-screen and sample it into a `<canvas>` via a rAF
	 * loop — stopping the loop freezes the canvas on the last drawn frame.
	 */

	const {
		src,
		alt,
		fallback,
		speaking = false,
		size = 96,
		class: className = ''
	}: {
		src?: string | null;
		alt: string;
		fallback: string;
		speaking?: boolean;
		size?: number;
		class?: string;
	} = $props();

	let img: HTMLImageElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let ready = $state(false);
	let raf = 0;

	function draw() {
		if (!canvas || !img || !img.naturalWidth) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		// Cover-fit
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		const scale = Math.max(canvas.width / iw, canvas.height / ih);
		const dw = iw * scale;
		const dh = ih * scale;
		const dx = (canvas.width - dw) / 2;
		const dy = (canvas.height - dh) / 2;
		try {
			ctx.drawImage(img, dx, dy, dw, dh);
		} catch {
			// Tainted canvas (cross-origin without CORS) — bail silently
		}
	}

	function startAnim() {
		cancelAnimationFrame(raf);
		const loop = () => {
			draw();
			raf = requestAnimationFrame(loop);
		};
		loop();
	}

	function stopAnim() {
		cancelAnimationFrame(raf);
		raf = 0;
		// One last paint so the freeze is on the latest frame
		draw();
	}

	$effect(() => {
		if (!ready) return;
		if (speaking) startAnim();
		else stopAnim();
	});

	onMount(() => {
		if (img?.complete) {
			ready = true;
			draw();
		}
	});

	onDestroy(() => cancelAnimationFrame(raf));

	function handleLoad() {
		ready = true;
		draw();
	}
</script>

<div
	class="relative overflow-hidden rounded-full {className}"
	style:width="{size}px"
	style:height="{size}px"
>
	{#if src}
		<!-- Off-screen animated source -->
		<img
			bind:this={img}
			{src}
			{alt}
			crossorigin="anonymous"
			onload={handleLoad}
			class="pointer-events-none absolute h-0 w-0 opacity-0"
		/>
		<canvas
			bind:this={canvas}
			width={size * 2}
			height={size * 2}
			class="block h-full w-full"
		></canvas>
		{#if !ready}
			<div class="absolute inset-0 flex items-center justify-center bg-muted text-sm font-medium text-muted-foreground">
				{fallback}
			</div>
		{/if}
	{:else}
		<div class="flex h-full w-full items-center justify-center bg-muted text-sm font-medium text-muted-foreground">
			{fallback}
		</div>
	{/if}
</div>
