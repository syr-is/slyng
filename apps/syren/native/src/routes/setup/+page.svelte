<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { Loader2 } from '@lucide/svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { setStoredHost } from '$lib/host-store';
	import { normalizeHost, isValidHost } from '@syren/app-core/normalize-host';
	import { setHost } from '@syren/app-core/host';

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
				const ret = page.url.searchParams.get('return') || '/';
				goto(ret, { replaceState: true });
			} catch (err) {
				f.errors.url = [err instanceof Error ? err.message : 'Could not reach the host'];
				f.valid = false;
			}
		}
	});
	const { form: formData, enhance, submitting } = form;
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	<form
		method="POST"
		use:enhance
		class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div class="space-y-1">
			<h1 class="text-xl font-semibold tracking-tight">Connect to a Syren server</h1>
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
						placeholder="syren.example.com"
						bind:value={$formData.url}
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
