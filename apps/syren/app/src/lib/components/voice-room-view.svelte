<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Volume2, MicOff, HeadphoneOff } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { getVoiceState, getChannelUsersFor } from '$lib/voice/voice-state.svelte';
	import { getVoiceActivity } from '$lib/voice/voice-activity.svelte';
	import { joinVoiceChannel, onRemoteVideo, onLocalVideo, MicPermissionError, isCameraOn, isScreenSharing } from '$lib/voice/voice-engine';
	import { attachStream } from '$lib/utils/attach-stream';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { proxied } from '$lib/utils/proxy';
	import AnimatedAvatar from './animated-avatar.svelte';

	const {
		channelId,
		channelName
	}: {
		channelId: string;
		channelName: string;
	} = $props();

	const voice = getVoiceState();
	const activity = getVoiceActivity();
	const auth = getAuth();

	const joined = $derived(voice.channelId === channelId);
	const inOtherChannel = $derived(voice.inVoice && voice.channelId !== channelId);

	// Remote video streams keyed by user DID
	const remoteVideos = new SvelteMap<string, MediaStream>();
	let localVideo = $state<MediaStream | null>(null);

	const unsubRemote = onRemoteVideo((userId, stream) => {
		if (stream) remoteVideos.set(userId, stream);
		else remoteVideos.delete(userId);
	});
	const unsubLocal = onLocalVideo((stream) => { localVideo = stream; });
	onDestroy(() => { unsubRemote(); unsubLocal(); });

	/**
	 * Tile list: every user connected to THIS voice channel (regardless of
	 * whether the viewer is also connected). If the viewer is joined, their
	 * own tile shows first with live mute/deafen state.
	 */
	const channelUsers = $derived(getChannelUsersFor(channelId));
	const tiles = $derived.by(() => {
		const selfDid = auth.identity?.did ?? '';
		const others = channelUsers.filter((u) => u.user_id !== selfDid);
		if (joined) {
			const self = {
				user_id: selfDid,
				self_mute: voice.selfMute,
				self_deaf: voice.selfDeaf,
				has_camera: isCameraOn(),
				has_screen: isScreenSharing(),
				is_self: true
			};
			return [self, ...others.map((u) => ({ ...u, is_self: false }))];
		}
		return others.map((u) => ({ ...u, is_self: false }));
	});

	async function handleJoin() {
		try {
			await joinVoiceChannel(channelId);
		} catch (err) {
			if (err instanceof MicPermissionError) toast.error(err.message);
			else toast.error('Could not join voice channel');
		}
	}
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
		<Volume2 class="h-5 w-5 text-muted-foreground" />
		<span class="font-semibold text-foreground">{channelName || 'voice'}</span>
		{#if joined}
			<span class="ml-2 text-xs text-green-500">Connected</span>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-6">
		{#if !joined}
			<div class="flex h-full flex-col items-center justify-center gap-4 text-center">
				<Volume2 class="h-12 w-12 text-muted-foreground/50" />
				<div class="space-y-1">
					<h2 class="text-lg font-semibold">#{channelName || 'voice'}</h2>
					<p class="text-sm text-muted-foreground">
						{inOtherChannel
							? 'You are currently connected to another voice channel.'
							: 'Join to start talking with everyone here.'}
					</p>
				</div>
				<Button onclick={handleJoin}>
					{inOtherChannel ? 'Switch to this channel' : 'Join voice'}
				</Button>
			</div>
		{:else if tiles.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
				<Volume2 class="h-10 w-10 opacity-30" />
				<p class="text-sm">You're here. Waiting for others...</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each tiles as tile (tile.user_id)}
					{@const profile = resolveProfile(tile.user_id, undefined)}
					{@const name = displayName(profile, tile.user_id)}
					{@const speaking = activity.isSpeaking(tile.user_id)}
					{@const videoStream = tile.is_self ? localVideo : remoteVideos.get(tile.user_id)}
					{@const showVideo = tile.is_self ? !!localVideo : (tile.has_camera || tile.has_screen)}
					<div
						class="group relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted/30 transition-all
							{speaking ? 'border-green-500 ring-2 ring-green-500/60' : 'border-border'}"
					>
						{#if showVideo && videoStream}
							<video
								autoplay
								playsinline
								muted={tile.is_self}
								class="h-full w-full object-contain"
								use:attachStream={videoStream}
							></video>
						{:else}
							<AnimatedAvatar
								src={profile.avatar_url ? proxied(profile.avatar_url) : null}
								alt={name}
								fallback={name.slice(0, 2).toUpperCase()}
								{speaking}
								size={128}
								class="shadow-md"
							/>
						{/if}

						<!-- Overlay footer -->
						<div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-3 py-2 text-xs text-white">
							<span class="flex items-center gap-1 truncate">
								{name}
								{#if tile.is_self}<span class="text-white/60">(you)</span>{/if}
							</span>
							<div class="flex shrink-0 gap-1">
								{#if tile.self_mute}
									<MicOff class="h-3.5 w-3.5 text-red-400" />
								{/if}
								{#if tile.self_deaf}
									<HeadphoneOff class="h-3.5 w-3.5 text-red-400" />
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
