<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { LoginRequestSchema } from '@syren/types';
	import { checkAuth } from '@syren/app-core/stores/auth.svelte';
	import { apiUrl } from '@syren/app-core/host';

	let activeTab = $state<'syr' | 'local'>('syr');
	let errorMsg = $state<string | null>(null);

	// Check for error from callback redirect
	const urlError = page.url.searchParams.get('error');
	if (urlError) errorMsg = decodeURIComponent(urlError);

	// Returns true if redirected (authed); false → render login form
	const authCheck = (async () => {
		if (urlError) return false;
		const user = await checkAuth();
		if (user) {
			const r = page.url.searchParams.get('redirect');
			goto(r && r.startsWith('/') ? r : '/channels/@me', { replaceState: true });
			return true;
		}
		return false;
	})();

	// Reuse the API's input schema directly — `LoginRequestSchema` is
	// generated from `LoginRequest` in `packages/rust/syren-types/`. The
	// post-redirect bridge step is the API's concern; here we just
	// validate the body shape before POSTing.
	const form = superForm(defaults(zod4(LoginRequestSchema)), {
		SPA: true,
		validators: zod4Client(LoginRequestSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			errorMsg = null;
			try {
				const postLoginRedirect = page.url.searchParams.get('redirect') ?? undefined;
				const res = await fetch(apiUrl('/auth/login'), {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						instance_url: f.data.instance_url.trim(),
						redirect: postLoginRedirect
					})
				});

				const data = (await res.json()) as { consent_url?: string; message?: string };

				if (!res.ok) {
					errorMsg = data.message || 'Failed to connect';
					return;
				}

				// Redirect to syr consent page
				if (data.consent_url) window.location.href = data.consent_url;
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Connection failed';
			}
		}
	});
	const { form: formData, enhance, submitting } = form;
</script>

{#await authCheck}
	<div class="flex min-h-screen items-center justify-center bg-background">
		<p class="text-sm text-muted-foreground">Loading...</p>
	</div>
{:then redirected}
	{#if !redirected}
		<div class="flex min-h-screen flex-col items-center justify-center bg-background p-4">
			<div class="mx-auto w-full max-w-md space-y-6">
				<div class="space-y-2 text-center">
					<h1 class="text-3xl font-bold tracking-tight text-foreground">Sign in to Syren</h1>
					<p class="text-sm text-muted-foreground">
						Connect with your syr identity or create a local profile
					</p>
				</div>

				<!-- Tab switcher -->
				<div class="flex rounded-lg border border-border">
					<button
						class="flex-1 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors {activeTab ===
						'syr'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (activeTab = 'syr')}
					>
						Sign in via Syr
					</button>
					<button
						class="flex-1 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors {activeTab ===
						'local'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => (activeTab = 'local')}
					>
						Local Profile
					</button>
				</div>

				{#if errorMsg}
					<div
						class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
					>
						{errorMsg}
					</div>
				{/if}

				{#if activeTab === 'syr'}
					<form method="POST" use:enhance class="space-y-4">
						<Form.Field {form} name="instance_url">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Your Syr Instance</Form.Label>
									<Input
										{...props}
										type="text"
										placeholder="syr.example.com"
										bind:value={$formData.instance_url}
										disabled={$submitting}
									/>
								{/snippet}
							</Form.Control>
							<Form.Description>
								Enter your syr instance URL. You'll sign in there and authorize Syren.
							</Form.Description>
							<Form.FieldErrors />
						</Form.Field>

						<Form.Button class="w-full" disabled={$submitting}>
							{#if $submitting}
								Connecting...
							{:else}
								Continue with Syr
							{/if}
						</Form.Button>

						<p class="text-center text-xs text-muted-foreground">
							You'll be redirected to your syr instance to sign in and authorize Syren
						</p>
					</form>
				{/if}

				{#if activeTab === 'local'}
					<div class="space-y-4">
						<div class="rounded-md border border-border bg-muted/50 p-3">
							<p class="text-xs text-muted-foreground">
								Without linking a syr instance, your messages won't be cryptographically verifiable.
								You can link an instance later from settings.
							</p>
						</div>

						<div class="space-y-2">
							<label for="handle" class="text-sm font-medium text-foreground">Handle</label>
							<input
								id="handle"
								type="text"
								required
								placeholder="your_handle"
								class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>

						<button
							class="w-full rounded-md bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
						>
							Create Local Profile
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/await}
