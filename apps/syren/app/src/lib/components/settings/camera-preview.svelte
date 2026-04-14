<script lang="ts">
	import { VideoOff } from '@lucide/svelte';
	import { attachStream } from '$lib/utils/attach-stream';

	const {
		stream,
		class: className = ''
	}: {
		stream: MediaStream | null;
		class?: string;
	} = $props();
</script>

<div class="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black {className}">
	{#if stream}
		<video
			autoplay
			playsinline
			muted
			class="h-full w-full object-contain"
			use:attachStream={stream}
		></video>
	{:else}
		<div class="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
			<VideoOff class="h-8 w-8" />
			<span class="text-xs">No camera active</span>
		</div>
	{/if}
</div>
