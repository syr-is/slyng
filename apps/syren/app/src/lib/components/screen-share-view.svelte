<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Maximize2, Minimize2, X } from '@lucide/svelte';
	import { onRemoteVideo } from '$lib/voice/voice-engine';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { attachStream } from '$lib/utils/attach-stream';

	/**
	 * Renders incoming screen-share video streams from voice-channel peers.
	 * Subscribes via `onRemoteVideo` — which fires when a peer's `ontrack`
	 * receives a video track (or a null stream on disconnect).
	 */

	const streams = new SvelteMap<string, MediaStream>();
	let expandedUser = $state<string | null>(null);

	const unsub = onRemoteVideo((userId, stream) => {
		if (stream) streams.set(userId, stream);
		else {
			streams.delete(userId);
			if (expandedUser === userId) expandedUser = null;
		}
	});

	onDestroy(() => unsub());

	function close(userId: string) {
		// Ignore the track locally but don't teardown peer — sender owns its lifecycle
		streams.delete(userId);
		if (expandedUser === userId) expandedUser = null;
	}
</script>

{#if streams.size > 0}
	{#if expandedUser && streams.has(expandedUser)}
		{@const stream = streams.get(expandedUser)!}
		{@const profile = resolveProfile(expandedUser, undefined)}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
			<div class="relative h-full w-full max-w-[90vw]">
				<div class="absolute left-0 right-0 top-0 flex items-center justify-between gap-2 p-3 text-sm text-white">
					<span class="rounded-md bg-black/60 px-2 py-1">
						{displayName(profile, expandedUser)}'s video
					</span>
					<div class="flex gap-1">
						<button
							onclick={() => (expandedUser = null)}
							class="rounded bg-black/60 p-2 hover:bg-black/80"
							title="Minimize"
						>
							<Minimize2 class="h-4 w-4" />
						</button>
						<button
							onclick={() => close(expandedUser!)}
							class="rounded bg-black/60 p-2 hover:bg-destructive/80"
							title="Close"
						>
							<X class="h-4 w-4" />
						</button>
					</div>
				</div>
				<video
					autoplay
					playsinline
					class="h-full w-full rounded-lg object-contain"
					use:attachStream={stream}
				></video>
			</div>
		</div>
	{:else}
		<div class="pointer-events-none absolute bottom-24 right-4 z-40 flex flex-col gap-2">
			{#each streams as [userId, stream] (userId)}
				{@const profile = resolveProfile(userId, undefined)}
				<div
					class="group pointer-events-auto relative h-40 w-64 overflow-hidden rounded-lg border border-border bg-black shadow-lg"
				>
					<video
						autoplay
						playsinline
						muted
						class="h-full w-full object-contain"
						use:attachStream={stream}
					></video>
					<div class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[11px] text-white">
						<span class="truncate">{displayName(profile, userId)}</span>
						<div class="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
							<button
								onclick={() => (expandedUser = userId)}
								class="rounded bg-black/60 p-1 hover:bg-black/80"
								title="Expand"
							>
								<Maximize2 class="h-3 w-3" />
							</button>
							<button
								onclick={() => close(userId)}
								class="rounded bg-black/60 p-1 hover:bg-destructive/80"
								title="Close"
							>
								<X class="h-3 w-3" />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}
