<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { checkAuth } from '@syren/app-core/stores/auth.svelte';
	import { apiUrl } from '@syren/app-core/host';

	let activeTab = $state<'syr' | 'local'>('syr');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let instanceUrl = $state('');

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

	async function handleSyrLogin(e: SubmitEvent) {
		e.preventDefault();
		if (!instanceUrl.trim()) return;
		loading = true;
		errorMsg = null;

		try {
			const postLoginRedirect = page.url.searchParams.get('redirect') ?? undefined;
			const res = await fetch(apiUrl('/auth/login'), {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instance_url: instanceUrl.trim(), redirect: postLoginRedirect })
			});

			const data = await res.json();

			if (!res.ok) {
				errorMsg = data.message || 'Failed to connect';
				return;
			}

			// Redirect to syr consent page
			window.location.href = data.consent_url;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Connection failed';
		} finally {
			loading = false;
		}
	}
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
			<form onsubmit={handleSyrLogin} class="space-y-4">
				<div class="space-y-2">
					<label for="instance_url" class="text-sm font-medium text-foreground">
						Your Syr Instance
					</label>
					<input
						id="instance_url"
						type="text"
						required
						bind:value={instanceUrl}
						placeholder="syr.example.com"
						class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					/>
					<p class="text-xs text-muted-foreground">
						Enter your syr instance URL. You'll sign in there and authorize Syren.
					</p>
				</div>

				<button
					type="submit"
					disabled={loading}
					class="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>
					{#if loading}
						Connecting...
					{:else}
						Continue with Syr
					{/if}
				</button>

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
