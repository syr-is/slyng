<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Loader2, Users } from '@lucide/svelte';
	import { checkAuth } from '@syren/app-core/stores/auth.svelte';
	import { api } from '@syren/app-core/api';
	import { proxied } from '@syren/app-core/utils/proxy';

	const code = $derived(page.params.code ?? '');

	type Preview = Awaited<ReturnType<typeof api.invites.preview>> & {
		target_kind?: 'open' | 'instance' | 'did';
		target_value?: string | null;
		label?: string | null;
	};

	let preview = $state<Preview | null>(null);
	let loadingPreview = $state(true);
	let previewError = $state<string | null>(null);
	let joining = $state(false);
	let joinError = $state<string | null>(null);
	let joined = $state(false);
	let joinedServerId = $state('');

	onMount(async () => {
		const user = await checkAuth();
		if (!user) {
			goto(`/login?redirect=${encodeURIComponent(`/invite/${code}`)}`);
			return;
		}
		try {
			preview = await api.invites.preview(code);
		} catch (err) {
			previewError = err instanceof Error ? err.message : 'Invalid invite';
		}
		loadingPreview = false;
	});

	async function join() {
		joining = true;
		joinError = null;
		try {
			const result = (await api.invites.join(code)) as any;
			joinedServerId = result.server_id;
			joined = true;
		} catch (err) {
			joinError = err instanceof Error ? err.message : 'Failed to join';
		}
		joining = false;
	}
</script>

<div
	class="relative flex min-h-screen items-center justify-center bg-background p-4"
	style={preview?.server.invite_background_url
		? `background-image: url('${proxied(preview.server.invite_background_url)}'); background-size: cover; background-position: center;`
		: ''}
>
	{#if preview?.server.invite_background_url}
		<div class="absolute inset-0 bg-background/70 backdrop-blur-sm"></div>
	{/if}

	<div class="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-lg">
		{#if preview?.server.banner_url}
			<div class="relative h-28 w-full overflow-hidden bg-muted">
				<img
					src={proxied(preview.server.banner_url)}
					alt=""
					class="h-full w-full object-cover"
				/>
			</div>
		{/if}

		<div class="space-y-4 p-6 text-center">
			{#if loadingPreview}
				<div class="flex items-center justify-center py-8 text-muted-foreground">
					<Loader2 class="mr-2 h-5 w-5 animate-spin" />
					Loading invite...
				</div>
			{:else if previewError}
				<h2 class="text-lg font-semibold text-destructive">Invalid Invite</h2>
				<p class="text-sm text-muted-foreground">{previewError}</p>
				<Button variant="outline" onclick={() => goto('/channels/@me')}>Go Home</Button>
			{:else if preview}
				<div class="flex flex-col items-center gap-2 {preview.server.banner_url ? '-mt-12' : ''}">
					<Avatar.Root class="h-16 w-16 border-4 border-card shadow-md">
						{#if preview.server.icon_url}
							<Avatar.Image src={proxied(preview.server.icon_url)} alt={preview.server.name} />
						{/if}
						<Avatar.Fallback class="text-lg">
							{preview.server.name.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
					<h2 class="text-xl font-semibold text-foreground">{preview.server.name}</h2>
					{#if preview.server.description}
						<p class="line-clamp-3 text-sm text-muted-foreground">{preview.server.description}</p>
					{/if}
					<div class="flex items-center gap-1 text-xs text-muted-foreground">
						<Users class="h-3.5 w-3.5" />
						<span>{preview.server.member_count} {preview.server.member_count === 1 ? 'member' : 'members'}</span>
					</div>

					{#if preview.target_kind === 'instance' && preview.target_value}
						<p class="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
							This invite is restricted to users on <span class="font-mono">{preview.target_value}</span>.
						</p>
					{:else if preview.target_kind === 'did'}
						<p class="rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-600 dark:text-purple-400">
							This invite is for a specific user only.
						</p>
					{/if}
				</div>

				{#if joined}
					<div class="space-y-2">
						<p class="text-sm text-foreground">You're in.</p>
						<Button class="w-full" onclick={() => goto(`/channels/${encodeURIComponent(joinedServerId)}`)}>
							Open Server
						</Button>
					</div>
				{:else}
					{#if joinError}
						<p class="text-sm text-destructive">{joinError}</p>
					{/if}
					<Button class="w-full" disabled={joining} onclick={join}>
						{joining ? 'Joining...' : 'Accept Invite'}
					</Button>
				{/if}
			{/if}
		</div>
	</div>
</div>
