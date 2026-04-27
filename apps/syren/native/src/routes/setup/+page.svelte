<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Label } from '@syren/ui/label';
	import { Loader2 } from '@lucide/svelte';
	import { setStoredHost } from '$lib/host-store';
	import { normalizeHost, isValidHost } from '@syren/app-core/normalize-host';
	import { setHost } from '@syren/app-core/host';

	let url = $state('');
	let testing = $state(false);
	let error = $state<string | null>(null);

	async function testAndSave(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = normalizeHost(url);
		if (!trimmed) {
			error = 'Enter your API host URL';
			return;
		}
		if (!isValidHost(trimmed)) {
			error = "That doesn't look like a valid URL.";
			return;
		}
		url = trimmed; // reflect the normalized value back into the field
		testing = true;
		error = null;
		try {
			setHost(trimmed);
			// `/api/auth/me` always exists. 200 → already signed in,
			// 401 → reachable but unauthed (expected first run). Any other
			// status (5xx, network error) means the URL is wrong.
			const res = await fetch(`${trimmed}/api/auth/me`, {
				method: 'GET',
				credentials: 'include'
			});
			if (res.status >= 500 || (res.status !== 200 && res.status !== 401)) {
				error = `Host responded ${res.status}. Double-check the URL.`;
				return;
			}
			await setStoredHost(trimmed);
			const ret = page.url.searchParams.get('return') || '/';
			goto(ret, { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not reach the host';
		} finally {
			testing = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	<form
		onsubmit={testAndSave}
		class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div class="space-y-1">
			<h1 class="text-xl font-semibold tracking-tight">Connect to a Syren server</h1>
			<p class="text-sm text-muted-foreground">
				Point this app at the API host you (or someone you trust) operate. You can change this
				later in Settings.
			</p>
		</div>

		<div class="space-y-2">
			<Label for="host">API host URL</Label>
			<Input
				id="host"
				type="text"
				inputmode="url"
				placeholder="syren.example.com"
				bind:value={url}
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck={false}
				disabled={testing}
			/>
			<p class="text-xs text-muted-foreground">
				Enter the host. <span class="font-mono">https://</span> is added automatically (or
				<span class="font-mono">http://</span> for <span class="font-mono">localhost</span> / LAN
				addresses). To force one, type <span class="font-mono">http://</span> or
				<span class="font-mono">https://</span> yourself.
			</p>
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<Button type="submit" class="w-full" disabled={testing}>
			{#if testing}
				<Loader2 class="mr-2 size-4 animate-spin" />
				Testing connection…
			{:else}
				Test &amp; continue
			{/if}
		</Button>
	</form>
</div>
