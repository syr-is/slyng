<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import {
		LoginRequestSchema,
		LocalLoginRequestSchema,
		LocalRegisterRequestSchema,
		type RegistrationInfo
	} from '@syren/types';
	import { checkAuth } from '@syren/app-core/stores/auth.svelte';
	import { api, apiReady } from '@syren/app-core/api';
	import { apiUrl } from '@syren/app-core/host';
	import { registerWithImport } from '@syren/app-core/upload/identity-migration';
	import SynerQr from '@syren/ui/fragments/syner-qr.svelte';
	import { onDestroy } from 'svelte';

	let activeTab = $state<'syr' | 'local'>('local');
	let localMode = $state<'login' | 'register' | 'import' | 'syner'>('login');
	let errorMsg = $state<string | null>(null);

	// Check for error from callback redirect
	const urlError = page.url.searchParams.get('error');
	if (urlError) errorMsg = decodeURIComponent(urlError);

	// Registration policy drives the local tab (invite field / closed notice)
	let regInfo = $state<RegistrationInfo | null>(null);
	$effect(() => {
		if (activeTab !== 'local' || regInfo) return;
		fetch(apiUrl('/auth/registration-info'))
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => (regInfo = d))
			.catch(() => {});
	});

	/**
	 * Complete a local auth response: trade the one-shot bridge token for
	 * a session (same handoff the OAuth callback uses — the WASM client
	 * persists it), then enter the app.
	 */
	async function completeLocalAuth(bridge: string) {
		await apiReady;
		await api.auth.exchange(bridge);
		const r = page.url.searchParams.get('redirect');
		await goto(r && r.startsWith('/') ? r : '/channels/@me', { replaceState: true });
	}

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

	// ── Local account forms ──────────────────────────────────────────

	const localLoginForm = superForm(defaults(zod4(LocalLoginRequestSchema)), {
		id: 'local-login',
		SPA: true,
		validators: zod4Client(LocalLoginRequestSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			errorMsg = null;
			try {
				const res = await fetch(apiUrl('/auth/local/login'), {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(f.data)
				});
				const data = (await res.json()) as { bridge?: string; message?: string };
				if (!res.ok || !data.bridge) {
					errorMsg = data.message || 'Sign-in failed';
					return;
				}
				await completeLocalAuth(data.bridge);
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Connection failed';
			}
		}
	});
	const {
		form: localLoginData,
		enhance: localLoginEnhance,
		submitting: localLoginSubmitting
	} = localLoginForm;

	const localRegisterForm = superForm(defaults(zod4(LocalRegisterRequestSchema)), {
		id: 'local-register',
		SPA: true,
		validators: zod4Client(LocalRegisterRequestSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			errorMsg = null;
			try {
				const body: Record<string, string> = {
					username: f.data.username,
					password: f.data.password,
					display_name: f.data.display_name
				};
				if (f.data.invite_code) body.invite_code = f.data.invite_code;
				const res = await fetch(apiUrl('/auth/register'), {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
				const data = (await res.json()) as { bridge?: string; message?: string };
				if (!res.ok || !data.bridge) {
					errorMsg = data.message || 'Registration failed';
					return;
				}
				await completeLocalAuth(data.bridge);
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Connection failed';
			}
		}
	});
	const {
		form: localRegisterData,
		enhance: localRegisterEnhance,
		submitting: localRegisterSubmitting
	} = localRegisterForm;

	// ── Import identity (register-with-import; P11) ──────────────────────
	let importFile = $state<File | null>(null);
	let importUsername = $state('');
	let importPassword = $state('');
	let importInvite = $state('');
	let importing = $state(false);

	async function submitImport(e: Event) {
		e.preventDefault();
		if (!importFile || !importUsername || !importPassword || importing) return;
		errorMsg = null;
		importing = true;
		try {
			const { bridge } = await registerWithImport({
				file: importFile,
				username: importUsername.trim(),
				password: importPassword,
				inviteCode: importInvite.trim() || undefined
			});
			await completeLocalAuth(bridge);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Import failed';
		}
		importing = false;
	}

	// ── Independent login (self-custody / Syner device; P10) ─────────────
	interface SynerLoginChallenge {
		challenge_id: string;
		message: string;
		deeplink_url: string;
		delegate_public_key: string;
		expires_in: number;
	}
	let synerDid = $state('');
	let synerChallenge = $state<SynerLoginChallenge | null>(null);
	let synerStarting = $state(false);
	let synerPollStopped = false;
	onDestroy(() => {
		synerPollStopped = true;
	});

	async function startSynerLogin(e: Event) {
		e.preventDefault();
		const did = synerDid.trim();
		if (!did || synerStarting) return;
		errorMsg = null;
		// Re-arm the poll loop: backing out of this sub-flow sets the flag true,
		// and without resetting it a second attempt would never poll.
		synerPollStopped = false;
		synerStarting = true;
		try {
			const res = await fetch(apiUrl('/auth/independent-login/challenge'), {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did })
			});
			const data = (await res.json()) as SynerLoginChallenge & {
				message?: string;
				error_description?: string;
			};
			if (!res.ok || !data.challenge_id) {
				errorMsg = data.error_description || data.message || 'Could not start device sign-in';
				synerStarting = false;
				return;
			}
			synerChallenge = data;
			void pollSynerLogin(data.challenge_id);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Connection failed';
		}
		synerStarting = false;
	}

	async function pollSynerLogin(challengeId: string) {
		while (!synerPollStopped) {
			await new Promise((r) => setTimeout(r, 2500));
			if (synerPollStopped) return;
			try {
				const res = await fetch(
					apiUrl(`/auth/independent-login/status?challenge_id=${encodeURIComponent(challengeId)}`),
					{ credentials: 'include' }
				);
				if (!res.ok) continue;
				const data = (await res.json()) as { verified: boolean; bridge: string | null };
				if (data.verified && data.bridge) {
					synerPollStopped = true;
					await completeLocalAuth(data.bridge);
					return;
				}
			} catch {
				// transient — keep polling
			}
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

				<!-- Both panels share a min-height and pin their primary button to
				     the bottom, so switching the Syr / Local tabs doesn't reflow
				     the card or move the submit button. -->
				{#if activeTab === 'syr'}
					<form method="POST" use:enhance class="flex min-h-[29rem] flex-col space-y-4">
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

						<Form.Button class="mt-auto w-full" disabled={$submitting}>
							{#if $submitting}
								Connecting...
							{:else}
								Continue with Syr
							{/if}
						</Form.Button>
					</form>
				{/if}

				{#if activeTab === 'local'}
					<div class="flex min-h-[29rem] flex-col space-y-4">
						<div class="rounded-md border border-border bg-muted/50 p-3">
							<p class="text-xs text-muted-foreground">
								Local profiles get a full syr identity hosted on this Syren instance — a did:syr,
								signing keys, and a profile usable across the syr federation.
							</p>
						</div>

						<!-- Sign in / Create account toggle (hidden in the device / import
						     sub-flows, which have their own back links) -->
						{#if localMode === 'login' || localMode === 'register'}
							<div class="flex justify-center gap-4 text-sm">
								<button
									class="font-medium transition-colors {localMode === 'login'
										? 'text-foreground underline underline-offset-4'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (localMode = 'login')}
								>
									Sign in
								</button>
								<button
									class="font-medium transition-colors {localMode === 'register'
										? 'text-foreground underline underline-offset-4'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (localMode = 'register')}
								>
									Create account
								</button>
							</div>
						{/if}

						{#if localMode === 'login'}
							<form method="POST" use:localLoginEnhance class="flex flex-1 flex-col space-y-4">
								<Form.Field form={localLoginForm} name="username">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>Username</Form.Label>
											<Input
												{...props}
												type="text"
												autocomplete="username"
												bind:value={$localLoginData.username}
												disabled={$localLoginSubmitting}
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
								<Form.Field form={localLoginForm} name="password">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>Password</Form.Label>
											<Input
												{...props}
												type="password"
												autocomplete="current-password"
												bind:value={$localLoginData.password}
												disabled={$localLoginSubmitting}
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
								<Form.Button class="mt-auto w-full" disabled={$localLoginSubmitting}>
									{#if $localLoginSubmitting}
										Signing in...
									{:else}
										Sign in
									{/if}
								</Form.Button>
								<button
									type="button"
									class="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
									onclick={() => (localMode = 'syner')}
								>
									Hold your own key? Sign in with your device
								</button>
							</form>
						{:else if localMode === 'syner'}
							<form onsubmit={startSynerLogin} class="flex flex-1 flex-col space-y-4">
								<div class="rounded-md border border-border bg-muted/50 p-3">
									<p class="text-xs text-muted-foreground">
										Self-custody sign-in: enter your <code>did:syr</code> and approve on the device
										that holds your key. No password is stored here.
									</p>
								</div>
								{#if !synerChallenge}
									<label class="space-y-1.5">
										<span class="text-sm font-medium">Your DID</span>
										<Input
											type="text"
											placeholder="did:syr:…"
											bind:value={synerDid}
											disabled={synerStarting}
										/>
									</label>
									<button
										type="submit"
										disabled={synerStarting || !synerDid.trim()}
										class="mt-auto w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
									>
										{synerStarting ? 'Preparing…' : 'Continue'}
									</button>
								{:else}
									<div class="flex flex-1 flex-col items-center justify-center gap-4">
										<SynerQr
											deeplinkUrl={synerChallenge.deeplink_url}
											delegateKey={synerChallenge.delegate_public_key}
										/>
									</div>
								{/if}
								<button
									type="button"
									class="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
									onclick={() => {
										synerChallenge = null;
										synerPollStopped = true;
										localMode = 'login';
									}}
								>
									← Back to sign in
								</button>
							</form>
						{:else if localMode === 'import'}
							<form onsubmit={submitImport} class="flex flex-1 flex-col space-y-4">
								<div class="rounded-md border border-border bg-muted/50 p-3">
									<p class="text-xs text-muted-foreground">
										Bring an identity you exported elsewhere. Your DID, profile, posts, and media are
										restored here under a new username; sign in afterwards with the same password.
									</p>
								</div>
								<label class="space-y-1.5">
									<span class="text-sm font-medium">Identity bundle (.zip)</span>
									<input
										type="file"
										accept=".zip,application/zip"
										onchange={(e) => (importFile = e.currentTarget.files?.[0] ?? null)}
										disabled={importing}
										class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
									/>
								</label>
								<label class="space-y-1.5">
									<span class="text-sm font-medium">New username</span>
									<Input type="text" placeholder="your_handle" bind:value={importUsername} disabled={importing} />
								</label>
								<label class="space-y-1.5">
									<span class="text-sm font-medium">Password</span>
									<Input
										type="password"
										autocomplete="current-password"
										placeholder="Your existing identity password"
										bind:value={importPassword}
										disabled={importing}
									/>
								</label>
								{#if regInfo?.mode === 'invite_only'}
									<label class="space-y-1.5">
										<span class="text-sm font-medium">Invite code</span>
										<Input type="text" bind:value={importInvite} disabled={importing} />
									</label>
								{/if}
								<button
									type="submit"
									disabled={importing || !importFile || !importUsername || !importPassword}
									class="mt-auto w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
								>
									{importing ? 'Importing…' : 'Import & sign in'}
								</button>
								<button
									type="button"
									class="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
									onclick={() => (localMode = 'register')}
								>
									← Back to create account
								</button>
							</form>
						{:else if regInfo?.mode === 'closed'}
							<div class="rounded-md border border-border bg-muted/50 p-3 text-center">
								<p class="text-sm text-muted-foreground">
									Registration is closed on this instance.
								</p>
							</div>
						{:else}
							<form method="POST" use:localRegisterEnhance class="flex flex-1 flex-col space-y-4">
								<Form.Field form={localRegisterForm} name="username">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>Username</Form.Label>
											<Input
												{...props}
												type="text"
												autocomplete="username"
												placeholder="your_handle"
												bind:value={$localRegisterData.username}
												disabled={$localRegisterSubmitting}
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
								<Form.Field form={localRegisterForm} name="display_name">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>Display name</Form.Label>
											<Input
												{...props}
												type="text"
												bind:value={$localRegisterData.display_name}
												disabled={$localRegisterSubmitting}
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
								<Form.Field form={localRegisterForm} name="password">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>Password</Form.Label>
											<Input
												{...props}
												type="password"
												autocomplete="new-password"
												bind:value={$localRegisterData.password}
												disabled={$localRegisterSubmitting}
											/>
										{/snippet}
									</Form.Control>
									<Form.Description>
										At least 8 characters with an uppercase letter, a lowercase letter, and a
										number. It also protects your identity's signing key.
									</Form.Description>
									<Form.FieldErrors />
								</Form.Field>
								{#if regInfo?.mode === 'invite_only'}
									<Form.Field form={localRegisterForm} name="invite_code">
										<Form.Control>
											{#snippet children({ props })}
												<Form.Label>Invite code</Form.Label>
												<Input
													{...props}
													type="text"
													bind:value={$localRegisterData.invite_code}
													disabled={$localRegisterSubmitting}
												/>
											{/snippet}
										</Form.Control>
										<Form.FieldErrors />
									</Form.Field>
								{/if}
								<Form.Button class="mt-auto w-full" disabled={$localRegisterSubmitting}>
									{#if $localRegisterSubmitting}
										Creating identity...
									{:else}
										Create account
									{/if}
								</Form.Button>
								<button
									type="button"
									class="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
									onclick={() => (localMode = 'import')}
								>
									Already have an identity? Import it
								</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/await}
