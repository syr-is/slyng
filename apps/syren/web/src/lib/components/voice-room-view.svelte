<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Volume2, MicOff, HeadphoneOff, Maximize2, Minimize2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import * as Avatar from '@syren/ui/avatar';
	import { getVoiceState, getChannelUsersFor } from '$lib/voice/voice-state.svelte';
	import {
		joinVoiceChannel, onRemoteVideo, onLocalVideo, MicPermissionError,
		isCameraOn, isScreenSharing, isSpeaking,
		getLocalCameraStream, getLocalScreenStream,
		type VideoSource, type VideoStreamKey
	} from '$lib/voice/livekit-engine';
	import { attachStream } from '$lib/utils/attach-stream';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { proxied } from '$lib/utils/proxy';

	const {
		channelId,
		channelName
	}: {
		channelId: string;
		channelName: string;
	} = $props();

	const voice = getVoiceState();
	const auth = getAuth();

	const joined = $derived(voice.channelId === channelId);
	const inOtherChannel = $derived(voice.inVoice && voice.channelId !== channelId);

	const remoteVideos = new SvelteMap<VideoStreamKey, { userId: string; source: VideoSource; stream: MediaStream }>();
	let localCamera = $state<MediaStream | null>(null);
	let localScreen = $state<MediaStream | null>(null);

	const unsubRemote = onRemoteVideo((key, userId, source, stream) => {
		if (stream) remoteVideos.set(key, { userId, source, stream });
		else remoteVideos.delete(key);
	});
	const unsubLocal = onLocalVideo(() => {
		localCamera = getLocalCameraStream();
		localScreen = getLocalScreenStream();
	});
	onDestroy(() => { unsubRemote(); unsubLocal(); });

	const channelUsers = $derived(getChannelUsersFor(channelId));

	interface Tile {
		id: string;
		userId: string;
		kind: 'avatar' | 'camera' | 'screen';
		stream: MediaStream | null;
		isSelf: boolean;
		selfMute: boolean;
		selfDeaf: boolean;
	}

	const tiles = $derived.by<Tile[]>(() => {
		const selfDid = auth.identity?.did ?? '';
		const result: Tile[] = [];

		const users = joined
			? [{ user_id: selfDid, self_mute: voice.selfMute, self_deaf: voice.selfDeaf, is_self: true },
				...channelUsers.filter((u) => u.user_id !== selfDid).map((u) => ({ ...u, is_self: false }))]
			: channelUsers.map((u) => ({ ...u, is_self: false }));

		for (const u of users) {
			const uid = u.user_id;
			const mute = u.self_mute ?? false;
			const deaf = u.self_deaf ?? false;
			const isSelf = u.is_self ?? false;

			const hasCam = isSelf ? !!localCamera : remoteVideos.has(`${uid}:camera` as VideoStreamKey);
			const hasScreen = isSelf ? !!localScreen : remoteVideos.has(`${uid}:screen` as VideoStreamKey);

			if (!hasCam && !hasScreen) {
				result.push({ id: `${uid}:avatar`, userId: uid, kind: 'avatar', stream: null, isSelf, selfMute: mute, selfDeaf: deaf });
			} else {
				if (hasCam) {
					const stream = isSelf ? localCamera : remoteVideos.get(`${uid}:camera` as VideoStreamKey)?.stream ?? null;
					result.push({ id: `${uid}:camera`, userId: uid, kind: 'camera', stream, isSelf, selfMute: mute, selfDeaf: deaf });
				}
				if (hasScreen) {
					const stream = isSelf ? localScreen : remoteVideos.get(`${uid}:screen` as VideoStreamKey)?.stream ?? null;
					result.push({ id: `${uid}:screen`, userId: uid, kind: 'screen', stream, isSelf, selfMute: mute, selfDeaf: deaf });
				}
			}
		}
		return result;
	});

	let expandedTileId = $state<string | null>(null);
	let fullscreenTileId = $state<string | null>(null);

	function handleExpand(tileId: string) {
		if (fullscreenTileId === tileId) {
			fullscreenTileId = null;
			expandedTileId = null;
		} else if (expandedTileId === tileId) {
			fullscreenTileId = tileId;
		} else {
			expandedTileId = tileId;
			fullscreenTileId = null;
		}
	}

	function exitFullscreen() {
		fullscreenTileId = null;
		expandedTileId = null;
	}

	const expandedTile = $derived(tiles.find((t) => t.id === expandedTileId) ?? null);
	const sidebarTiles = $derived(expandedTileId ? tiles.filter((t) => t.id !== expandedTileId) : []);

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

	<div class="flex-1 overflow-hidden p-4">
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
			<!-- Fullscreen overlay -->
			{#if fullscreenTileId}
				{@const ft = tiles.find((t) => t.id === fullscreenTileId)}
				{#if ft?.stream}
					{@const profile = resolveProfile(ft.userId, undefined)}
					{@const name = displayName(profile, ft.userId)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="fixed inset-0 z-50 flex items-center justify-center bg-black" onclick={exitFullscreen}>
						<video autoplay playsinline muted={ft.isSelf} class="max-h-full max-w-full object-contain" use:attachStream={ft.stream}></video>
						<button type="button" onclick={(e) => { e.stopPropagation(); exitFullscreen(); }} class="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
							<Minimize2 class="h-5 w-5" />
						</button>
						<div class="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white">
							<Avatar.Root class="h-6 w-6">
								{#if profile.avatar_url}<Avatar.Image src={proxied(profile.avatar_url)} alt="" />{/if}
								<Avatar.Fallback class="text-[9px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							{name}
							<span class="rounded bg-white/20 px-1.5 py-0.5 text-[10px] uppercase">{ft.kind}</span>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Expanded: main + sidebar -->
			{#if expandedTile && !fullscreenTileId}
				{@const expProfile = resolveProfile(expandedTile.userId, undefined)}
				{@const expName = displayName(expProfile, expandedTile.userId)}
				<div class="flex h-full gap-3">
					<div class="group relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
						{#if expandedTile.stream}
							<video autoplay playsinline muted={expandedTile.isSelf} class="h-full w-full object-contain" use:attachStream={expandedTile.stream}></video>
						{:else}
							<Avatar.Root class="h-24 w-24">
								{#if expProfile.avatar_url}<Avatar.Image src={proxied(expProfile.avatar_url)} alt={expName} />{/if}
								<Avatar.Fallback class="text-2xl">{expName.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
						{/if}
						<button type="button" onclick={() => handleExpand(expandedTile.id)} class="absolute right-2 top-2 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" title="Fullscreen">
							<Maximize2 class="h-4 w-4" />
						</button>
						<div class="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
							<Avatar.Root class="h-6 w-6">
								{#if expProfile.avatar_url}<Avatar.Image src={proxied(expProfile.avatar_url)} alt={expName} />{/if}
								<Avatar.Fallback class="text-[9px]">{expName.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<span class="text-xs text-white">{expName}</span>
							{#if expandedTile.kind !== 'avatar'}
								<span class="rounded bg-white/20 px-1 py-0.5 text-[9px] uppercase text-white">{expandedTile.kind}</span>
							{/if}
						</div>
					</div>
					<div class="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto">
						{#each sidebarTiles as tile (tile.id)}
							{@render tileCard(tile, true)}
						{/each}
					</div>
				</div>

			<!-- Normal grid -->
			{:else if !fullscreenTileId}
				<div class="grid h-full auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each tiles as tile (tile.id)}
						{@render tileCard(tile, false)}
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

{#snippet tileCard(tile: Tile, compact: boolean)}
	{@const profile = resolveProfile(tile.userId, undefined)}
	{@const name = displayName(profile, tile.userId)}
	{@const speaking = isSpeaking(tile.userId)}
	<div
		class="group relative flex items-center justify-center overflow-hidden rounded-lg border bg-muted/30 transition-all
			{compact ? '' : 'aspect-video'}
			{speaking ? 'border-green-500 ring-2 ring-green-500/60' : 'border-border'}"
	>
		{#if tile.kind !== 'avatar' && tile.stream}
			<video autoplay playsinline muted={tile.isSelf} class="h-full w-full object-contain" use:attachStream={tile.stream}></video>
			<button type="button" onclick={() => handleExpand(tile.id)} class="absolute right-1.5 top-1.5 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" title="Expand">
				<Maximize2 class="h-3.5 w-3.5" />
			</button>
			<div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[11px] text-white">
				<span class="flex items-center gap-1.5 truncate">
					<Avatar.Root class="h-5 w-5 shrink-0">
						{#if profile.avatar_url}<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />{/if}
						<Avatar.Fallback class="text-[8px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
					{name}
					{#if tile.isSelf}<span class="text-white/50">(you)</span>{/if}
					{#if tile.kind === 'screen'}<span class="rounded bg-white/20 px-1 py-0.5 text-[9px] uppercase">Screen</span>{/if}
				</span>
				<div class="flex shrink-0 gap-1">
					{#if tile.selfMute}<MicOff class="h-3 w-3 text-red-400" />{/if}
					{#if tile.selfDeaf}<HeadphoneOff class="h-3 w-3 text-red-400" />{/if}
				</div>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-2 p-4">
				<Avatar.Root class="{compact ? 'h-10 w-10' : 'h-16 w-16'} {speaking ? 'ring-2 ring-green-500' : ''}">
					{#if profile.avatar_url}<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />{/if}
					<Avatar.Fallback class="{compact ? 'text-xs' : 'text-lg'}">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
				</Avatar.Root>
				{#if !compact}<span class="text-xs text-muted-foreground">{name}</span>{/if}
			</div>
			<div class="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 text-[11px] text-muted-foreground">
				<span class="truncate">{name}{#if tile.isSelf} (you){/if}</span>
				<div class="flex shrink-0 gap-1">
					{#if tile.selfMute}<MicOff class="h-3 w-3 text-red-400" />{/if}
					{#if tile.selfDeaf}<HeadphoneOff class="h-3 w-3 text-red-400" />{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}
