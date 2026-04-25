<script lang="ts">
	import { onDestroy } from 'svelte';

	const { stream }: { stream: MediaStream | null } = $props();

	const SEGMENTS = 20;
	let level = $state(0); // 0..1

	let ctx: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let buffer: Uint8Array<ArrayBuffer> | null = null;
	let raf = 0;

	function teardown() {
		cancelAnimationFrame(raf);
		raf = 0;
		source?.disconnect();
		source = null;
		analyser?.disconnect();
		analyser = null;
		buffer = null;
		ctx?.close().catch(() => {});
		ctx = null;
		level = 0;
	}

	function start(s: MediaStream) {
		teardown();
		const audioTracks = s.getAudioTracks();
		if (!audioTracks.length) return;

		ctx = new AudioContext();
		analyser = ctx.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.6;
		source = ctx.createMediaStreamSource(s);
		source.connect(analyser);
		buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));

		const loop = () => {
			if (!analyser || !buffer) return;
			analyser.getByteTimeDomainData(buffer);
			let sumSq = 0;
			for (let i = 0; i < buffer.length; i++) {
				const v = (buffer[i] - 128) / 128;
				sumSq += v * v;
			}
			const rms = Math.sqrt(sumSq / buffer.length);
			// Log-scale so normal speech maps to a pleasant mid-meter range
			level = Math.min(1, Math.max(0, rms * 3));
			raf = requestAnimationFrame(loop);
		};
		loop();
	}

	$effect(() => {
		if (stream) start(stream);
		else teardown();
	});

	onDestroy(teardown);

	const litCount = $derived(Math.round(level * SEGMENTS));
</script>

<div class="flex h-6 w-full items-center gap-0.5">
	{#each Array(SEGMENTS) as _, i}
		{@const lit = i < litCount}
		{@const hue = i < SEGMENTS * 0.7 ? 'bg-green-500' : i < SEGMENTS * 0.9 ? 'bg-yellow-500' : 'bg-red-500'}
		<div
			class="h-full flex-1 rounded-sm transition-opacity {lit ? hue : 'bg-muted'}"
			style:opacity={lit ? 1 : 0.3}
		></div>
	{/each}
</div>
