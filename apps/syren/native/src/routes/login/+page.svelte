<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Label } from '@syren/ui/label';
	import { apiUrl } from '@syren/app-core/host';
	import { normalizeHost, isValidHost } from '$lib/normalize-host';
	import { Loader2 } from '@lucide/svelte';

	let instanceUrl = $state('');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	// Surface error code from a previous OAuth callback round-trip.
	const urlError = page.url.searchParams.get('error');
	if (urlError) {
		const map: Record<string, string> = {
			invalid_state:
				"Login session expired or got mixed up. This is usually a cookie issue — try once more, and if it keeps happening on this device, contact your admin.",
			session_expired: 'Login session expired. Try again.',
			missing_code: 'Sign-in was cancelled.',
			missing_delegation_id: 'Your syr instance returned an incomplete response. Try again.'
		};
		errorMsg = map[urlError] ?? decodeURIComponent(urlError);
	}

	async function handleSyrLogin(e: SubmitEvent) {
		e.preventDefault();
		const normalized = normalizeHost(instanceUrl);
		if (!normalized) return;
		if (!isValidHost(normalized)) {
			errorMsg = "That doesn't look like a valid URL.";
			return;
		}
		instanceUrl = normalized;
		loading = true;
		errorMsg = null;
		try {
			const res = await fetch(apiUrl('/auth/login'), {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					instance_url: normalized,
					// Round-trip back to the native shell after OAuth instead
					// of landing on the deployed web app served by the API host.
					redirect: 'tauri://localhost/channels/@me'
				})
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.message || 'Failed to connect';
				return;
			}
			window.location.href = data.consent_url;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Connection failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	<form
		onsubmit={handleSyrLogin}
		class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div class="space-y-1">
			<h1 class="text-xl font-semibold tracking-tight">Sign in with syr</h1>
			<p class="text-sm text-muted-foreground">
				Enter your syr instance to continue. You'll be redirected for consent.
			</p>
		</div>
		<div class="space-y-2">
			<Label for="instance">Instance URL</Label>
			<Input
				id="instance"
				type="text"
				inputmode="url"
				placeholder="syr.example.com"
				bind:value={instanceUrl}
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck={false}
				disabled={loading}
			/>
			<p class="text-xs text-muted-foreground">
				Just the host. <span class="font-mono">https://</span> is added automatically (or
				<span class="font-mono">http://</span> for <span class="font-mono">localhost</span> / LAN).
				To force one, type the protocol yourself.
			</p>
			{#if errorMsg}
				<p class="text-sm text-destructive">{errorMsg}</p>
			{/if}
		</div>
		<Button type="submit" class="w-full" disabled={loading}>
			{#if loading}<Loader2 class="mr-2 size-4 animate-spin" />Connecting…{:else}Continue{/if}
		</Button>
		<button
			type="button"
			class="w-full text-xs text-muted-foreground hover:text-foreground"
			onclick={() => goto('/setup')}
		>
			Change API host
		</button>
	</form>
</div>
