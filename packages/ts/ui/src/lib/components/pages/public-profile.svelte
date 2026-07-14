<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import * as Avatar from '@syren/ui/avatar';
	import { Loader2, BadgeCheck } from '@lucide/svelte';
	import { apiUrl } from '@syren/app-core/host';
	import { proxied } from '@syren/app-core/utils/proxy';
	import type { PublicProfileData } from '@syren/types';
	import FollowButton from '../fragments/follow-button.svelte';

	/**
	 * Public (logged-out accessible) profile page for identities hosted on
	 * THIS instance — the `web_profile` target advertised by our
	 * `/.well-known/syr/:did` manifest. Remote identities are viewed on
	 * their own instance's web profile, so this only reads our public API.
	 */
	const param = $derived(page.params.param ?? '');

	let profile = $state<PublicProfileData | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch(apiUrl(`/public/profile/${encodeURIComponent(param)}`), {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) {
				error = res.status === 404 ? 'Profile not found' : 'Failed to load profile';
				return;
			}
			const body = (await res.json()) as { data?: PublicProfileData };
			profile = body.data ?? null;
			if (!profile) error = 'Failed to load profile';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load profile';
		} finally {
			loading = false;
		}
	});

	const initials = $derived(
		(profile?.display_name || profile?.username || '?')
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="flex min-h-screen flex-col items-center bg-background">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<Loader2 class="size-8 animate-spin text-muted-foreground" />
		</div>
	{:else if error || !profile}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
			<h1 class="text-xl font-semibold text-foreground">{error ?? 'Profile not found'}</h1>
			<a href="/" class="text-sm text-muted-foreground underline underline-offset-4">
				Back to Syren
			</a>
		</div>
	{:else}
		<div class="w-full max-w-2xl">
			<!-- Banner -->
			<div class="h-40 w-full overflow-hidden bg-muted sm:h-52 sm:rounded-b-lg">
				{#if profile.banner_url}
					<img
						src={proxied(profile.banner_url)}
						alt=""
						class="h-full w-full object-cover"
						draggable="false"
					/>
				{/if}
			</div>

			<div class="px-4 sm:px-6">
				<!-- Avatar overlapping the banner -->
				<div class="-mt-10 sm:-mt-12">
					<Avatar.Root class="size-20 border-4 border-background sm:size-24">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={profile.display_name ?? ''} />
						{/if}
						<Avatar.Fallback class="text-xl">{initials}</Avatar.Fallback>
					</Avatar.Root>
				</div>

				<div class="mt-3 space-y-1">
					<h1 class="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-foreground">
						<span class="truncate">{profile.display_name || profile.username}</span>
						{#if profile.content_signature}
							<BadgeCheck class="size-5 shrink-0 text-primary" aria-label="Signed profile" />
						{/if}
					</h1>
					<p class="truncate text-sm text-muted-foreground">@{profile.username}</p>
					{#if profile.did}
						<p class="max-w-full truncate font-mono text-xs text-muted-foreground" title={profile.did}>
							{profile.did}
						</p>
					{/if}
				</div>

				{#if profile.did}
					<div class="mt-4">
						<FollowButton did={profile.did} provider={profile.identity_host_url ?? undefined} />
					</div>
				{/if}

				{#if profile.bio}
					<p class="mt-4 text-sm whitespace-pre-wrap text-foreground">{profile.bio}</p>
				{/if}

				<div class="mt-8 border-t border-border pt-4">
					<p class="text-xs text-muted-foreground">
						Hosted on this Syren instance ·
						<a href="/" class="underline underline-offset-4 hover:text-foreground">Open Syren</a>
					</p>
				</div>
			</div>
		</div>
	{/if}
</div>
