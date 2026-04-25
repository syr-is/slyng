<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Label } from '@syren/ui/label';
	import { apiUrl } from '@syren/app-core/host';
	import { Loader2 } from '@lucide/svelte';

	let instanceUrl = $state('');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	async function handleSyrLogin(e: SubmitEvent) {
		e.preventDefault();
		if (!instanceUrl.trim()) return;
		loading = true;
		errorMsg = null;
		try {
			const res = await fetch(apiUrl('/auth/login'), {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instance_url: instanceUrl.trim() })
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.message || 'Failed to connect';
				return;
			}
			// Open consent URL in default browser; backend redirects to /api/auth/callback.
			// On native, let the system browser handle this. Tauri's opener plugin or
			// `window.open` with `target=_blank` both work; webview navigation also works
			// for HTTPS hosts.
			window.location.href = data.consent_url;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Connection failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-6">
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
				type="url"
				placeholder="https://syr.example.com"
				bind:value={instanceUrl}
				disabled={loading}
			/>
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
