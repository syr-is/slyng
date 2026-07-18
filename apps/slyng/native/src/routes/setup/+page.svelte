<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Input } from '@slyng/ui/input';
	import * as Form from '@slyng/ui/form';
	import { Loader2 } from '@lucide/svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { setStoredHost, getStoredHost, getStoredHostSync } from '$lib/host-store';
	import { addRecentHost, getRecentHosts, getRecentHostsSync } from '$lib/auth-prefs';
	import { normalizeHost, isValidHost } from '@slyng/app-core/normalize-host';
	import { setHost } from '@slyng/app-core/host';

	// Hand-written rather than reusing a Rust struct: this is a setup
	// flow that doesn't hit the API at all (it just probes /api/auth/me
	// to confirm the host responds), so there's nothing to centralize
	// against. The schema enforces the same shape `normalizeHost` /
	// `isValidHost` already check, plus the live-probe in `superRefine`.
	const SetupSchema = z
		.object({
			url: z.string().min(1, 'Enter your API host URL')
		})
		.superRefine((data, ctx) => {
			const trimmed = normalizeHost(data.url);
			if (!trimmed || !isValidHost(trimmed)) {
				ctx.addIssue({
					code: 'custom',
					path: ['url'],
					message: "That doesn't look like a valid URL."
				});
			}
		});

	const form = superForm(defaults(zod4(SetupSchema)), {
		SPA: true,
		validators: zod4Client(SetupSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			const trimmed = normalizeHost(f.data.url)!;
			f.data.url = trimmed;
			try {
				setHost(trimmed);
				// `/api/auth/me` always exists. 200 → already signed in,
				// 401 → reachable but unauthed (expected first run). Any other
				// status means the URL is wrong.
				const res = await fetch(`${trimmed}/api/auth/me`, {
					method: 'GET',
					credentials: 'include'
				});
				if (res.status >= 500 || (res.status !== 200 && res.status !== 401)) {
					f.errors.url = [`Host responded ${res.status}. Double-check the URL.`];
					f.valid = false;
					return;
				}
				await setStoredHost(trimmed);
				// Track for the "Recently used" shortcuts next time. The
				// localStorage layer is written synchronously inside, so
				// navigating away immediately is safe.
				void addRecentHost(trimmed);
				const ret = page.url.searchParams.get('return') || '/';
				goto(ret, { replaceState: true });
			} catch (err) {
				f.errors.url = [err instanceof Error ? err.message : 'Could not reach the host'];
				f.valid = false;
			}
		}
	});
	const { form: formData, enhance, submitting } = form;

	// Prefill with the currently configured host so re-entering setup via
	// "Change API host" is scan-and-adjust, not recall-and-re-enter.
	{
		const current = getStoredHostSync();
		if (current) $formData.url = current;
	}

	// Recently used hosts — one tap to refill the field.
	let recentHosts = $state<string[]>(getRecentHostsSync());

	onMount(() => {
		// Backfill from the Tauri Store when the localStorage cache was
		// wiped (e.g. Android cleared WebView data).
		void (async () => {
			if (!$formData.url) {
				const stored = await getStoredHost();
				if (stored && !$formData.url) $formData.url = stored;
			}
			const hosts = await getRecentHosts();
			if (hosts.length) recentHosts = hosts;
		})();
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	<form
		method="POST"
		use:enhance
		class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div class="space-y-1">
			<h1 class="text-xl font-semibold tracking-tight">Connect to a Slyng server</h1>
			<p class="text-sm text-muted-foreground">
				Point this app at the API host you (or someone you trust) operate. You can change this
				later in Settings.
			</p>
		</div>

		<Form.Field {form} name="url">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>API host URL</Form.Label>
					<Input
						{...props}
						type="text"
						inputmode="url"
						placeholder="slyng.example.com"
						bind:value={$formData.url}
						onfocus={(e) => e.currentTarget.select()}
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck={false}
						disabled={$submitting}
					/>
				{/snippet}
			</Form.Control>
			<Form.Description>
				Enter the host. <span class="font-mono">https://</span> is added automatically (or
				<span class="font-mono">http://</span> for <span class="font-mono">localhost</span> / LAN
				addresses). To force one, type <span class="font-mono">http://</span> or
				<span class="font-mono">https://</span> yourself.
			</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		{#if recentHosts.length}
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Recently used</p>
				<div class="flex flex-wrap gap-1.5">
					{#each recentHosts as host (host)}
						<button
							type="button"
							class="max-w-full truncate rounded-md border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
							onclick={() => ($formData.url = host)}
							disabled={$submitting}
						>
							{host}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<Form.Button class="w-full" disabled={$submitting}>
			{#if $submitting}
				<Loader2 class="mr-2 size-4 animate-spin" />
				Testing connection…
			{:else}
				Test &amp; continue
			{/if}
		</Form.Button>
	</form>
</div>
