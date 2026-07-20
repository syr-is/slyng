<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Avatar from '@slyng/ui/avatar';
	import { Button } from '@slyng/ui/button';
	import { Loader2, Users } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { checkAuth } from '@slyng/app-core/stores/auth.svelte';
	import { api } from '@slyng/app-core/api';
	import { proxied } from '@slyng/app-core/utils/proxy';

	const code = $derived(page.params.code ?? '');

	type Preview = Awaited<ReturnType<typeof api.invites.preview>>;

	let preview = $state<Preview | null>(null);
	let loadingPreview = $state(true);
	let previewError = $state<string | null>(null);
	let authed = $state(false);
	let joining = $state(false);
	let joinError = $state<string | null>(null);
	let joined = $state(false);
	let joinedServerId = $state('');

	// The dedicated invite background is the hero when present; the banner
	// is the fallback; otherwise a gradient stands in.
	const heroUrl = $derived(
		preview?.server.invite_background_url ?? preview?.server.banner_url ?? null
	);
	const memberCount = $derived(preview?.server.member_count ?? 0);

	onMount(async () => {
		// The preview endpoint is @Public() on the API — never gate it behind
		// login. Auth state only decides which CTA renders: an actual join for
		// visitors with a session, or a continue-through-login handoff that
		// returns here via the `redirect` param. The join POST itself stays
		// auth-enforced server-side.
		authed = (await checkAuth()) !== null;
		try {
			preview = await api.invites.preview(code);
		} catch (err) {
			previewError = err instanceof Error ? err.message : 'Invalid invite';
			toast.error(previewError);
		}
		loadingPreview = false;
	});

	async function join() {
		joining = true;
		joinError = null;
		try {
			const result = await api.invites.join(code);
			joinedServerId = result.server_id;
			joined = true;
		} catch (err) {
			joinError = err instanceof Error ? err.message : 'Failed to join';
			toast.error(joinError);
		}
		joining = false;
	}

	function continueToJoin() {
		goto(`/login?redirect=${encodeURIComponent(`/invite/${code}`)}`);
	}
</script>

<div class="relative min-h-screen bg-background">
	{#if preview?.server.invite_background_url}
		<!-- Backdrop image is rendered as an <img> rather than an inline
		     `style="background-image: url('…')"` so untrusted federated URLs
		     containing `'`, `)`, or `;` can't escape the CSS string and
		     inject arbitrary declarations. The proxy already handles SSRF;
		     this closes the CSS-injection surface. Desktop-only ambience —
		     on mobile the same image is the in-card hero instead. -->
		<img
			src={proxied(preview.server.invite_background_url)}
			alt=""
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 hidden h-full w-full object-cover sm:block"
		/>
		<div class="absolute inset-0 hidden bg-background/70 backdrop-blur-sm sm:block"></div>
	{/if}

	<div class="relative flex min-h-screen flex-col sm:items-center sm:justify-center sm:p-4">
		{#if loadingPreview}
			<div class="flex flex-1 items-center justify-center p-6 text-muted-foreground sm:flex-none">
				<Loader2 class="mr-2 h-5 w-5 animate-spin" />
				Loading invite...
			</div>
		{:else if previewError}
			<div class="flex flex-1 items-center justify-center p-4 sm:w-full sm:flex-none">
				<div
					class="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-lg"
				>
					<div
						class="h-24 w-full bg-gradient-to-br from-destructive/40 via-destructive/15 to-card"
					></div>
					<div class="space-y-4 p-6 text-center">
						<h1 class="text-lg font-semibold text-destructive">Invalid Invite</h1>
						<p class="text-sm text-muted-foreground">{previewError}</p>
						{#if authed}
							<Button variant="outline" onclick={() => goto('/channels/@me')}>Go Home</Button>
						{:else}
							<Button variant="outline" onclick={() => goto('/login')}>Go to Login</Button>
						{/if}
					</div>
				</div>
			</div>
		{:else if preview}
			<div
				class="flex w-full flex-1 flex-col overflow-hidden bg-card sm:max-w-md sm:flex-none sm:rounded-xl sm:border sm:border-border sm:shadow-lg"
			>
				<!-- Hero: owns ≥45% of the viewport on mobile; compact banner on
				     desktop where the card floats over the blurred backdrop. -->
				<div class="relative h-[48vh] min-h-64 w-full shrink-0 overflow-hidden sm:h-56 sm:min-h-0">
					{#if heroUrl}
						<img
							src={proxied(heroUrl)}
							alt=""
							class="absolute inset-0 h-full w-full object-cover"
						/>
					{:else}
						<div
							class="absolute inset-0 bg-gradient-to-br from-primary/50 via-primary/20 to-card"
						></div>
					{/if}
					<div class="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent"></div>
					<div
						class="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-6 pb-5 text-center"
					>
						<Avatar.Root class="h-20 w-20 border-4 border-card shadow-md">
							{#if preview.server.icon_url}
								<Avatar.Image
									src={proxied(preview.server.icon_url)}
									alt={preview.server.name ?? ''}
								/>
							{/if}
							<Avatar.Fallback class="text-xl">
								{(preview.server.name ?? '').slice(0, 2).toUpperCase() || '??'}
							</Avatar.Fallback>
						</Avatar.Root>
						<p class="text-xs font-medium tracking-widest text-muted-foreground uppercase">
							You've been invited to join
						</p>
						<h1 class="line-clamp-2 max-w-full text-2xl font-bold break-words text-foreground">
							{preview.server.name}
						</h1>
					</div>
				</div>

				<div class="flex flex-1 flex-col gap-4 p-6 text-center sm:flex-none">
					{#if preview.server.description}
						<p class="line-clamp-3 text-sm text-muted-foreground">{preview.server.description}</p>
					{/if}

					{#if preview.target_kind === 'instance' && preview.target_value}
						<p
							class="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-600 dark:text-blue-400"
						>
							This invite is restricted to users on <span class="font-mono break-all"
								>{preview.target_value}</span
							>.
						</p>
					{:else if preview.target_kind === 'did'}
						<p
							class="rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-600 dark:text-purple-400"
						>
							This invite is for a specific user only.
						</p>
					{/if}

					{#if joined}
						<div class="mt-auto space-y-3 pb-2 sm:mt-0 sm:pb-0">
							<p class="text-base font-semibold text-foreground">You're in.</p>
							<Button
								class="w-full"
								size="lg"
								onclick={() => goto(`/channels/${encodeURIComponent(joinedServerId)}`)}
							>
								<span class="truncate">Open {preview.server.name}</span>
							</Button>
						</div>
					{:else}
						<div class="mt-auto space-y-3 pb-2 sm:mt-0 sm:pb-0">
							{#if joinError}
								<p
									class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
									{joinError}
								</p>
							{/if}

							{#if memberCount > 0}
								<p class="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
									<Users class="h-4 w-4 shrink-0" />
									<span
										>Join {memberCount}
										{memberCount === 1 ? 'other' : 'others'} already here</span
									>
								</p>
							{/if}

							{#if authed}
								<Button class="w-full" size="lg" disabled={joining} onclick={join}>
									{#if joining}
										<Loader2 class="h-4 w-4 animate-spin" />
										Joining...
									{:else}
										<span class="truncate">Join {preview.server.name}</span>
									{/if}
								</Button>
								<p class="text-xs text-muted-foreground">
									Free to join. Leave anytime — no one is notified.
								</p>
							{:else}
								<Button class="w-full" size="lg" onclick={continueToJoin}>Continue to join</Button>
								<div class="space-y-1 text-xs text-muted-foreground">
									<p>You'll need a Slyng identity — it takes a minute.</p>
									<p>Free to join. Leave anytime — no one is notified.</p>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
