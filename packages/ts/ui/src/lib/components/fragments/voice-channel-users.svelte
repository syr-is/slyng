<script lang="ts">
	import { MicOff, HeadphoneOff, Video } from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { getMembers } from '@syren/app-core/stores/members.svelte';
	import { getChannelUsersFor } from '@syren/app-core/voice/voice-state.svelte';
	import { isSpeaking } from '@syren/app-core/voice/livekit-engine';
	import { proxied } from '@syren/app-core/utils/proxy';

	const { channelId }: { channelId: string } = $props();

	const memberStore = getMembers();
	const users = $derived(getChannelUsersFor(channelId));

	function instanceFor(userId: string): string | undefined {
		return memberStore.list.find((m) => m.user_id === userId)?.syr_instance_url;
	}
</script>

{#if users.length > 0}
	<div class="ml-4 space-y-0.5 py-0.5">
		{#each users as user (user.user_id)}
			{@const profile = resolveProfile(user.user_id, instanceFor(user.user_id))}
			{@const name = displayName(profile, user.user_id)}
			{@const speaking = isSpeaking(user.user_id)}
			<div class="flex items-center gap-1.5 rounded px-1.5 py-0.5">
				<Avatar.Root
					class="h-5 w-5 transition-shadow {speaking ? 'ring-2 ring-green-500' : ''}"
				>
					{#if profile.avatar_url}
						<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
					{/if}
					<Avatar.Fallback class="text-[9px]">
						{name.slice(0, 2).toUpperCase()}
					</Avatar.Fallback>
				</Avatar.Root>
				<span class="flex-1 truncate text-xs text-sidebar-foreground/70">
					{name}
				</span>
				{#if user.has_screen}
					<span class="shrink-0 rounded bg-destructive px-1 py-px text-[8px] font-bold uppercase leading-none text-destructive-foreground">Live</span>
				{:else if user.has_camera}
					<Video class="h-3 w-3 shrink-0 text-green-500" />
				{/if}
				{#if user.self_mute}
					<MicOff class="h-3 w-3 shrink-0 text-destructive/60" />
				{/if}
				{#if user.self_deaf}
					<HeadphoneOff class="h-3 w-3 shrink-0 text-destructive/60" />
				{/if}
			</div>
		{/each}
	</div>
{/if}
