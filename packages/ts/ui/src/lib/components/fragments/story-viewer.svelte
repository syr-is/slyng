<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Dialog from '@syren/ui/dialog';
	import * as Avatar from '@syren/ui/avatar';
	import { X, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from '@lucide/svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { resolveStories } from '@syren/app-core/stores/stories.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const IMAGE_DURATION_MS = 5000;

	const {
		open,
		did,
		instanceUrl,
		onClose
	}: {
		open: boolean;
		did: string;
		instanceUrl?: string;
		onClose: () => void;
	} = $props();

	const profile = $derived(resolveProfile(did, instanceUrl));
	const name = $derived(displayName(profile, did));
	const handle = $derived(federatedHandle(profile, did));
	const stories = $derived(resolveStories(did, instanceUrl));
	const slides = $derived(stories.slides);

	let index = $state(0);
	let progress = $state(0); // 0..1 for current slide
	let paused = $state(false);
	let muted = $state(true);
	let videoEl: HTMLVideoElement | undefined = $state();
	let startTs = 0;
	let elapsedBeforePause = 0;
	let rafId: number | null = null;

	const currentSlide = $derived(slides[index]);
	const isVideo = $derived(!!currentSlide?.mime_type.startsWith('video/'));
	const durationMs = $derived(
		isVideo && currentSlide?.duration_seconds
			? currentSlide.duration_seconds * 1000
			: IMAGE_DURATION_MS
	);

	function reset() {
		index = 0;
		progress = 0;
		paused = false;
		elapsedBeforePause = 0;
	}

	$effect(() => {
		if (!open) {
			stopTicker();
			reset();
			return;
		}
	});

	// Start/restart ticker when slide changes (and while open)
	$effect(() => {
		if (!open) return;
		void index; // track
		progress = 0;
		elapsedBeforePause = 0;
		if (isVideo) {
			// Video drives progress via its own timeupdate events
			stopTicker();
		} else {
			startTicker();
		}
	});

	function startTicker() {
		stopTicker();
		startTs = performance.now();
		const tick = (now: number) => {
			if (paused) {
				rafId = requestAnimationFrame(tick);
				return;
			}
			const elapsed = elapsedBeforePause + (now - startTs);
			progress = Math.min(1, elapsed / durationMs);
			if (progress >= 1) {
				advance();
				return;
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
	}

	function stopTicker() {
		if (rafId != null) cancelAnimationFrame(rafId);
		rafId = null;
	}

	function pause() {
		if (paused) return;
		paused = true;
		if (isVideo) {
			videoEl?.pause();
		} else {
			elapsedBeforePause += performance.now() - startTs;
			stopTicker();
		}
	}

	function resume() {
		if (!paused) return;
		paused = false;
		if (isVideo) {
			videoEl?.play();
		} else {
			startTs = performance.now();
			startTicker();
		}
	}

	function togglePause() {
		if (paused) resume();
		else pause();
	}

	function advance() {
		if (index < slides.length - 1) {
			index++;
		} else {
			close();
		}
	}

	function prev() {
		if (index > 0) index--;
		else progress = 0;
	}

	function close() {
		stopTicker();
		onClose();
	}

	function onVideoTimeUpdate() {
		if (!videoEl || !videoEl.duration) return;
		progress = Math.min(1, videoEl.currentTime / videoEl.duration);
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') advance();
		else if (e.key === ' ') {
			e.preventDefault();
			togglePause();
		}
	}

	function relativeTime(iso: string): string {
		const now = Date.now();
		const then = new Date(iso).getTime();
		const diff = Math.max(0, now - then);
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', onKey);
		stopTicker();
	});
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) close(); }}>
	<Dialog.Content
		showCloseButton={false}
		class="fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black/95 p-0 text-white shadow-none sm:max-w-none"
	>
		{#if slides.length > 0 && currentSlide}
			<div class="relative flex h-[100dvh] w-full items-center justify-center">
				<!-- Progress bars -->
				<div class="absolute left-0 right-0 top-0 z-20 flex gap-1 px-4 pt-3">
					{#each slides as _, i}
						<div class="h-0.5 flex-1 overflow-hidden rounded-full bg-white/20">
							<div
								class="h-full bg-white transition-[width] duration-100"
								style="width: {i < index ? '100%' : i === index ? progress * 100 + '%' : '0%'}"
							></div>
						</div>
					{/each}
				</div>

				<!-- Header -->
				<div class="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 px-4 pb-4 pt-6 bg-gradient-to-b from-black/70 to-transparent">
					<Avatar.Root class="h-9 w-9">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
						{/if}
						<Avatar.Fallback class="text-xs text-black">
							{name.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold">{name}</p>
						<p class="truncate font-mono text-[11px] text-white/60">
							{handle} · {relativeTime(currentSlide.published_at)}
						</p>
					</div>
					<button
						type="button"
						class="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
						onclick={togglePause}
						title={paused ? 'Resume' : 'Pause'}
					>
						{#if paused}
							<Play class="h-4 w-4" />
						{:else}
							<Pause class="h-4 w-4" />
						{/if}
					</button>
					{#if isVideo}
						<button
							type="button"
							class="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
							onclick={() => (muted = !muted)}
							title={muted ? 'Unmute' : 'Mute'}
						>
							{#if muted}
								<VolumeX class="h-4 w-4" />
							{:else}
								<Volume2 class="h-4 w-4" />
							{/if}
						</button>
					{/if}
					<button
						type="button"
						class="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
						onclick={close}
						title="Close"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Media -->
				<div class="flex h-full w-full items-center justify-center p-4">
					{#if isVideo}
						<video
							bind:this={videoEl}
							src={proxied(currentSlide.url)}
							class="max-h-full max-w-full rounded-lg object-contain"
							autoplay
							playsinline
							muted={muted}
							ontimeupdate={onVideoTimeUpdate}
							onended={advance}
						>
							<track kind="captions" label="Captions unavailable" />
						</video>
					{:else}
						<img
							src={proxied(currentSlide.url)}
							alt=""
							class="max-h-full max-w-full rounded-lg object-contain"
							draggable={false}
						/>
					{/if}
				</div>

				<!-- Tap zones: left third → prev, right two-thirds → next. Transparent. -->
				<button
					type="button"
					class="absolute bottom-0 left-0 top-16 w-1/3"
					onclick={prev}
					aria-label="Previous"
				></button>
				<button
					type="button"
					class="absolute bottom-0 right-0 top-16 w-2/3"
					onclick={advance}
					aria-label="Next"
				></button>

				<!-- Chevrons (desktop affordance) -->
				{#if index > 0}
					<button
						type="button"
						class="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white"
						onclick={prev}
						aria-label="Previous"
					>
						<ChevronLeft class="h-6 w-6" />
					</button>
				{/if}
				{#if index < slides.length - 1}
					<button
						type="button"
						class="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white"
						onclick={advance}
						aria-label="Next"
					>
						<ChevronRight class="h-6 w-6" />
					</button>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
