<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Avatar from '@slyng/ui/avatar';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { Loader2, ShieldCheck, KeyRound } from '@lucide/svelte';
	import { idpJson } from '@slyng/app-core/idp-fetch';
	import { checkAuth } from '@slyng/app-core/stores/auth.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import SynerQr from '@slyng/ui/fragments/syner-qr.svelte';

	/**
	 * Platform consent page — the IdP-side approval screen external
	 * platforms send users to. Two entry modes, mirroring syr's
	 * /auth/platform-consent:
	 *   ?challenge=<id>        → pre-registered via POST /api/platform/register
	 *   ?platform_origin=&…    → direct entry; we register the pending
	 *                            delegation on load
	 */

	interface ConsentInfo {
		challenge_id: string;
		platform_name: string;
		platform_origin: string;
		scopes: string[];
		did: string;
		display_name: string | null;
		avatar_url: string | null;
		has_aegis: boolean;
	}

	const SCOPE_DESCRIPTIONS: Record<string, string> = {
		'identity:read': 'Read your DID and public profile',
		'identity:verify': 'Verify credentials issued to you',
		'profile:read': 'Read your display name, bio, and avatar',
		'posts:read': 'Read your posts',
		'posts:write': 'Create and edit posts on your behalf'
	};

	interface SynerChallenge {
		challenge_id: string;
		message: string;
		deeplink_url: string;
		delegate_public_key: string;
		expires_in: number;
	}

	let info = $state<ConsentInfo | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let password = $state('');
	let submitting = $state(false);
	let denying = $state(false);

	// Self-custody (Syner) approval state.
	let syner = $state<SynerChallenge | null>(null);
	let synerError = $state<string | null>(null);
	let pollStopped = false;
	onDestroy(() => {
		pollStopped = true;
	});

	onMount(async () => {
		const user = await checkAuth();
		if (!user) {
			const target = page.url.pathname + page.url.search;
			goto(`/login?redirect=${encodeURIComponent(target)}`, { replaceState: true });
			return;
		}
		try {
			const challenge = page.url.searchParams.get('challenge');
			if (challenge) {
				info = await idpJson<ConsentInfo>(`/platform/consent/${encodeURIComponent(challenge)}`);
			} else {
				const q = page.url.searchParams;
				if (!q.get('platform_origin') || !q.get('callback_url')) {
					error = 'Missing required parameters: platform_origin, callback_url';
					return;
				}
				info = await idpJson<ConsentInfo>('/platform/consent', {
					method: 'POST',
					body: JSON.stringify({
						platform_origin: q.get('platform_origin'),
						platform_name: q.get('platform_name') || undefined,
						callback_url: q.get('callback_url'),
						scopes: q.get('scopes') || undefined,
						state: q.get('state') || undefined
					})
				});
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load consent request';
		} finally {
			loading = false;
		}

		// Self-custody identities can't approve with a password — mint a
		// device-signing challenge and wait for the Syner device.
		if (info && !info.has_aegis) void startSyner();
	});

	async function startSyner() {
		if (!info) return;
		synerError = null;
		try {
			syner = await idpJson<SynerChallenge>(
				`/platform/consent/${encodeURIComponent(info.challenge_id)}/syner-challenge`,
				{ method: 'POST', body: JSON.stringify({}) }
			);
			void pollSynerStatus(info.challenge_id);
		} catch (err) {
			synerError = err instanceof Error ? err.message : 'Failed to start device approval';
		}
	}

	async function pollSynerStatus(challengeId: string) {
		while (!pollStopped) {
			await new Promise((r) => setTimeout(r, 2500));
			if (pollStopped) return;
			try {
				const res = await idpJson<{ signed: boolean; redirect_url: string | null }>(
					`/platform/consent/${encodeURIComponent(challengeId)}/status`
				);
				if (res.signed && res.redirect_url) {
					pollStopped = true;
					window.location.href = res.redirect_url;
					return;
				}
			} catch {
				// Transient network / not-yet-signed — keep polling until unmount.
			}
		}
	}

	async function approve() {
		if (!info || !password) return;
		submitting = true;
		error = null;
		try {
			const res = await idpJson<{ redirect_url: string }>(
				`/platform/consent/${encodeURIComponent(info.challenge_id)}/approve`,
				{ method: 'POST', body: JSON.stringify({ password }) }
			);
			window.location.href = res.redirect_url;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Approval failed';
			submitting = false;
		}
	}

	async function deny() {
		if (!info) return;
		denying = true;
		try {
			const res = await idpJson<{ redirect_url: string }>(
				`/platform/consent/${encodeURIComponent(info.challenge_id)}/deny`,
				{ method: 'POST', body: JSON.stringify({}) }
			);
			window.location.href = res.redirect_url;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed';
			denying = false;
		}
	}

	const initials = $derived(
		(info?.display_name || '?')
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
	{#if loading}
		<Loader2 class="size-8 animate-spin text-muted-foreground" />
	{:else if error && !info}
		<div class="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-6 text-center">
			<h1 class="text-lg font-semibold text-foreground">Consent request unavailable</h1>
			<p class="text-sm text-destructive">{error}</p>
			<Button variant="ghost" onclick={() => goto('/channels/@me')}>Back to Slyng</Button>
		</div>
	{:else if info}
		<div class="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-6 shadow-sm">
			<div class="space-y-1 text-center">
				<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
					<ShieldCheck class="size-6 text-primary" />
				</div>
				<h1 class="text-xl font-semibold tracking-tight text-foreground">
					Authorize {info.platform_name}
				</h1>
				<p class="truncate font-mono text-xs text-muted-foreground">{info.platform_origin}</p>
			</div>

			<!-- Who is approving -->
			<div class="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
				<Avatar.Root class="size-10">
					{#if info.avatar_url}
						<Avatar.Image src={proxied(info.avatar_url)} alt="" />
					{/if}
					<Avatar.Fallback>{initials}</Avatar.Fallback>
				</Avatar.Root>
				<div class="min-w-0">
					<p class="truncate text-sm font-medium text-foreground">{info.display_name}</p>
					<p class="truncate font-mono text-xs text-muted-foreground" title={info.did}>
						{info.did}
					</p>
				</div>
			</div>

			<!-- Requested scopes -->
			<div class="space-y-2">
				<p class="text-sm font-medium text-foreground">This platform will be able to:</p>
				<ul class="space-y-1.5">
					{#each info.scopes as scope (scope)}
						<li class="flex items-start gap-2 text-sm text-muted-foreground">
							<span class="mt-1 size-1.5 shrink-0 rounded-full bg-primary"></span>
							{SCOPE_DESCRIPTIONS[scope] ?? scope}
						</li>
					{/each}
				</ul>
				<p class="text-xs text-muted-foreground">
					A dedicated signing key is created for this platform. You can revoke it at any time from
					Settings → Connections.
				</p>
			</div>

			{#if info.has_aegis}
				<div class="space-y-2">
					<label for="consent-password" class="flex items-center gap-1.5 text-sm font-medium text-foreground">
						<KeyRound class="size-4" /> Confirm with your password
					</label>
					<Input
						id="consent-password"
						type="password"
						autocomplete="current-password"
						bind:value={password}
						disabled={submitting || denying}
						onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && approve()}
					/>
					<p class="text-xs text-muted-foreground">
						Your password unlocks your identity key to sign the delegation. It never leaves this
						instance.
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
						<KeyRound class="size-4" /> Approve on your device
					</div>
					<p class="text-xs text-muted-foreground">
						Your identity key is self-custodied — scan this with your Syner device (or open the
						link on it) to sign the delegation. Nothing here can sign for you.
					</p>
					{#if syner}
						<SynerQr deeplinkUrl={syner.deeplink_url} delegateKey={syner.delegate_public_key} />
					{:else if synerError}
						<p class="text-sm text-destructive">{synerError}</p>
						<Button variant="outline" size="sm" onclick={startSyner}>Try again</Button>
					{:else}
						<div class="flex justify-center py-6">
							<Loader2 class="size-6 animate-spin text-muted-foreground" />
						</div>
					{/if}
				</div>
			{/if}

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<div class="flex gap-2">
				<Button variant="outline" class="flex-1" onclick={deny} disabled={submitting || denying}>
					{#if denying}<Loader2 class="mr-2 size-4 animate-spin" />{/if}
					Deny
				</Button>
				<!-- Only Aegis (password-custodied) identities authorize here. Self-custody
				     approves on the device via the QR above, so a password-gated Authorize
				     button would sit permanently disabled and read as broken. -->
				{#if info.has_aegis}
					<Button class="flex-1" onclick={approve} disabled={submitting || denying || !password}>
						{#if submitting}<Loader2 class="mr-2 size-4 animate-spin" />{/if}
						Authorize
					</Button>
				{/if}
			</div>
		</div>
	{/if}
</div>
