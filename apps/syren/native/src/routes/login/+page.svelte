<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listen } from '@tauri-apps/api/event';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { invoke } from '@tauri-apps/api/core';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import {
		LocalLoginRequestSchema,
		LocalRegisterRequestSchema,
		type RegistrationInfo
	} from '@syren/types';
	import { getStoredHostSync } from '$lib/host-store';
	import { api } from '@syren/app-core/api';
	import { apiUrl } from '@syren/app-core/host';
	import { normalizeHost, isValidHost } from '@syren/app-core/normalize-host';
	import { registerWithImport } from '@syren/app-core/upload/identity-migration';
	import SynerQr from '@syren/ui/fragments/syner-qr.svelte';
	import { Loader2 } from '@lucide/svelte';

	// Survives across webview restarts (Android can kill the backgrounded
	// app while the user is in the system browser). When set, we restore
	// the "Completing sign-in…" state on mount so the user never sees a
	// reset login form during an in-flight OAuth round-trip.
	const OAUTH_STATE_KEY = 'syren_oauth_state';
	const OAUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes — well beyond the polling cap

	interface OAuthState {
		instance_url: string;
		started_at: number;
	}

	/** True from the moment the system browser opens until the OAuth
	 *  round-trip resolves (auth-changed / auth-error) or times out. */
	let signingIn = $state(false);
	let displayInstanceUrl = $state('');
	let errorMsg = $state<string | null>(null);

	let authTab = $state<'syr' | 'local'>('local');
	let localMode = $state<'login' | 'register' | 'import' | 'syner'>('login');

	// Registration policy drives the local tab (invite field / closed notice)
	let regInfo = $state<RegistrationInfo | null>(null);
	$effect(() => {
		if (authTab !== 'local' || regInfo) return;
		fetch(apiUrl('/auth/registration-info'))
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => (regInfo = d))
			.catch(() => {});
	});

	/**
	 * Complete a local auth response: swap the one-shot bridge token for a
	 * session via the Tauri `login_complete` command (persists in the Tauri
	 * Store, same as the OAuth deep-link path), then enter the app.
	 */
	async function completeLocalAuth(bridge: string) {
		await api.auth.exchange(bridge);
		redirected = true;
		await goto('/channels/@me', { replaceState: true });
	}

	const urlError = page.url.searchParams.get('error');
	if (urlError) {
		const map: Record<string, string> = {
			invalid_state: 'Login session expired. Try again.',
			session_expired: 'Login session expired. Try again.',
			missing_code: 'Sign-in was cancelled.',
			missing_delegation_id: 'Your syr instance returned an incomplete response. Try again.'
		};
		errorMsg = map[urlError] ?? decodeURIComponent(urlError);
	}

	let unlisten: (() => void) | undefined;
	let unlistenError: (() => void) | undefined;

	let polling: ReturnType<typeof setInterval> | undefined;
	let pollingTimeout: ReturnType<typeof setTimeout> | undefined;
	let redirected = false;

	function readPendingOAuth(): OAuthState | null {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(OAUTH_STATE_KEY);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as OAuthState;
			if (!parsed.started_at || Date.now() - parsed.started_at > OAUTH_TTL_MS) {
				localStorage.removeItem(OAUTH_STATE_KEY);
				return null;
			}
			return parsed;
		} catch {
			localStorage.removeItem(OAUTH_STATE_KEY);
			return null;
		}
	}

	function clearPendingOAuth() {
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem(OAUTH_STATE_KEY);
		}
	}

	function startPolling() {
		if (polling) clearInterval(polling);
		if (pollingTimeout) clearTimeout(pollingTimeout);
		polling = setInterval(() => void checkAndRedirect('poll'), 1500);
		pollingTimeout = setTimeout(() => {
			if (polling) {
				clearInterval(polling);
				polling = undefined;
			}
			pollingTimeout = undefined;
			// 2 minutes is enough for any reasonable OAuth round-trip.
			// If we're still here, the user probably abandoned consent
			// or the deep-link delivery failed silently. Reset the UI
			// so they can try again.
			if (signingIn) {
				signingIn = false;
				clearPendingOAuth();
				if (!errorMsg) {
					errorMsg = "Sign-in didn't complete in time. Tap Continue to try again.";
				}
			}
		}, 120_000);
	}

	function stopPolling() {
		if (polling) {
			clearInterval(polling);
			polling = undefined;
		}
		if (pollingTimeout) {
			clearTimeout(pollingTimeout);
			pollingTimeout = undefined;
		}
	}

	async function checkAndRedirect(reason: string) {
		if (redirected) return;
		// Both the api singleton (Tauri-IPC `me` command) and the OAuth
		// flow share the same Tauri Store as their session source — no
		// localStorage mirror needed any more.
		try {
			await api.auth.me();
			if (import.meta.env.DEV) console.log(`[login] self-correct: /auth/me succeeded (${reason})`);
			redirected = true;
			stopPolling();
			clearPendingOAuth();
			// Deliberately leave `signingIn` true. Setting it to false
			// here would flip the {#if signingIn} branch to the form for
			// one render frame before `goto` unmounts the page, producing
			// a visible "form flash" on slow mobile devices where polling
			// (rather than the auth-changed event) ends up resolving the
			// flow.
			goto('/channels/@me', { replaceState: true });
		} catch {
			// Still unauthenticated — stay on /login.
		}
	}

	function onVisibility() {
		if (document.visibilityState === 'visible') {
			void checkAndRedirect('visibilitychange');
		}
	}
	function onFocus() {
		void checkAndRedirect('focus');
	}

	function cancelSigningIn() {
		stopPolling();
		clearPendingOAuth();
		signingIn = false;
		errorMsg = null;
	}

	// ── Form ──
	// Hand-written rather than reusing a Rust struct: the API's
	// `LoginRequestSchema` is what the *server* expects; this is the
	// pre-server, client-side instance-URL parsing step (`syr.example.com`
	// → `https://syr.example.com`). The actual `instance_url` we POST to
	// the API is the normalized output of this schema's transform.
	const LoginFormSchema = z
		.object({
			instance_url: z.string().min(1, 'Enter a syr instance URL')
		})
		.superRefine((data, ctx) => {
			const normalized = normalizeHost(data.instance_url);
			if (!normalized || !isValidHost(normalized)) {
				ctx.addIssue({
					code: 'custom',
					path: ['instance_url'],
					message: "That doesn't look like a valid URL."
				});
			}
		});

	const form = superForm(defaults(zod4(LoginFormSchema)), {
		SPA: true,
		validators: zod4Client(LoginFormSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			const normalized = normalizeHost(f.data.instance_url)!;
			f.data.instance_url = normalized;

			const apiHost = getStoredHostSync();
			if (!apiHost) {
				errorMsg = 'API host not configured.';
				return;
			}
			errorMsg = null;
			try {
				// Persist OAuth-in-flight state BEFORE opening the browser so
				// that if the OS kills our WebView while the user is in the
				// system browser, the next mount can restore the
				// "Completing sign-in…" state instead of showing an empty form.
				if (typeof localStorage !== 'undefined') {
					const state: OAuthState = {
						instance_url: normalized,
						started_at: Date.now()
					};
					localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(state));
				}
				// Rust opens the consent URL in the system browser. After the
				// user completes consent, syr.is redirects to our API
				// callback, which bounces to `syren://auth/callback?syren_bridge=...`.
				// The OS routes that into Tauri; the deep-link handler calls
				// `syren-client::login_complete`, which fetches `/auth/me` and
				// emits `auth-changed`. The listener above handles the
				// navigation into the app.
				await invoke('start_login', { apiHost, instanceUrl: normalized });
				displayInstanceUrl = normalized;
				signingIn = true;
				// Poll `/auth/me` while the user is in the system browser.
				// If `auth-changed` is missed (event not buffered, fired
				// before our listener attached, etc.) the next poll catches
				// the persisted session and routes us into the app anyway.
				startPolling();
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Connection failed';
				clearPendingOAuth();
			}
		}
	});
	const { form: formData, enhance, submitting } = form;

	// ── Local account forms (mirrors web login page) ──────────────────

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
	// Both this and the device sign-in below finish through completeLocalAuth,
	// which already exchanges the bridge via the Tauri session store — so the
	// same flows the web login offers work unchanged on native.
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

	onMount(() => {
		// Restore in-flight OAuth state if the WebView was killed while
		// the user was in the system browser. Without this, returning to
		// the app shows a fresh empty form for several seconds before
		// polling discovers the session — looks like the app hung.
		const pending = readPendingOAuth();
		if (pending) {
			$formData.instance_url = pending.instance_url;
			displayInstanceUrl = pending.instance_url;
			signingIn = true;
			startPolling();
		}

		void (async () => {
			unlisten = await listen<unknown>('auth-changed', async (event) => {
				if (import.meta.env.DEV) console.log('[login] auth-changed authed=', !!event.payload);
				if (!event.payload) return;
				// The Tauri-side login_complete already persisted the
				// session in the Tauri Store; the api singleton reads
				// from there directly via the `me` command. No mirror.
				redirected = true;
				stopPolling();
				clearPendingOAuth();
				goto('/channels/@me', { replaceState: true });
			});
			unlistenError = await listen<string>('auth-error', (event) => {
				if (import.meta.env.DEV) console.log('[login] auth-error', event.payload);
				const msg =
					typeof event.payload === 'string' && event.payload
						? event.payload
						: 'Sign-in did not complete';
				errorMsg = msg;
				signingIn = false;
				stopPolling();
				clearPendingOAuth();
			});
		})();

		// Initial check covers the case where the page mounted *after*
		// auth-changed already fired (deep-link delivered fast).
		void checkAndRedirect('mount');
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('focus', onFocus);
	});

	onDestroy(() => {
		synerPollStopped = true;
		unlisten?.();
		unlistenError?.();
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('focus', onFocus);
		stopPolling();
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	{#if signingIn}
		<!-- Persistent "completing sign-in" UI. Stays visible while the
		     user is in the system browser AND while we're waiting for
		     either the auth-changed deep-link callback or the polling
		     fallback to land. -->
		<div class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
			<div class="flex justify-center">
				<Loader2 class="size-8 animate-spin text-primary" />
			</div>
			<div class="space-y-1">
				<h1 class="text-xl font-semibold tracking-tight">Completing sign-in…</h1>
				<p class="text-sm text-muted-foreground">
					Finish authorising in your browser. We'll bring you back automatically.
				</p>
			</div>
			{#if displayInstanceUrl}
				<p class="font-mono text-xs text-muted-foreground">{displayInstanceUrl}</p>
			{/if}
			{#if errorMsg}
				<p class="text-sm text-destructive">{errorMsg}</p>
			{/if}
			<Button type="button" variant="ghost" size="sm" class="w-full" onclick={cancelSigningIn}>
				Cancel and try again
			</Button>
		</div>
	{:else}
		<div class="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
			<!-- Tab switcher -->
			<div class="flex rounded-lg border border-border">
				<button
					type="button"
					class="flex-1 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors {authTab ===
					'syr'
						? 'bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (authTab = 'syr')}
				>
					Sign in via Syr
				</button>
				<button
					type="button"
					class="flex-1 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors {authTab ===
					'local'
						? 'bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (authTab = 'local')}
				>
					Local account
				</button>
			</div>

			<!-- Both panels share a min-height and pin their primary button to
			     the bottom, so switching the Syr / Local tabs doesn't reflow
			     the card or move the submit button. -->
			{#if authTab === 'syr'}
				<form
					method="POST"
					use:enhance
					class="flex min-h-[29rem] flex-col space-y-4"
				>
					<div class="space-y-1">
						<h1 class="text-xl font-semibold tracking-tight">Sign in with syr</h1>
						<p class="text-sm text-muted-foreground">
							Enter your syr instance to continue. You'll be redirected for consent.
						</p>
					</div>

					<Form.Field {form} name="instance_url">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Instance URL</Form.Label>
								<Input
									{...props}
									type="text"
									inputmode="url"
									placeholder="syr.example.com"
									bind:value={$formData.instance_url}
									autocomplete="off"
									autocorrect="off"
									autocapitalize="off"
									spellcheck={false}
									disabled={$submitting}
								/>
							{/snippet}
						</Form.Control>
						<Form.Description>
							Just the host. <span class="font-mono">https://</span> is added automatically (or
							<span class="font-mono">http://</span> for
							<span class="font-mono">localhost</span> / LAN). To force one, type the protocol
							yourself.
						</Form.Description>
						<Form.FieldErrors />
					</Form.Field>

					{#if errorMsg}
						<p class="text-sm text-destructive">{errorMsg}</p>
					{/if}

					<Form.Button class="mt-auto w-full" disabled={$submitting}>
						{#if $submitting}<Loader2 class="mr-2 size-4 animate-spin" />Opening browser…{:else}Continue{/if}
					</Form.Button>
				</form>
			{:else}
				<div class="flex min-h-[29rem] flex-col space-y-4">
					<p class="text-xs text-muted-foreground">
						Local accounts get a full syr identity hosted on this Syren instance — a did:syr,
						signing keys, and a profile usable across the syr federation.
					</p>

					<!-- Toggle hidden in the device / import sub-flows, which carry
					     their own back links. -->
					{#if localMode === 'login' || localMode === 'register'}
						<div class="flex justify-center gap-4 text-sm">
							<button
								type="button"
								class="font-medium transition-colors {localMode === 'login'
									? 'text-foreground underline underline-offset-4'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (localMode = 'login')}
							>
								Sign in
							</button>
							<button
								type="button"
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
											autocapitalize="off"
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
							{#if errorMsg}
								<p class="text-sm text-destructive">{errorMsg}</p>
							{/if}
							<Form.Button class="mt-auto w-full" disabled={$localLoginSubmitting}>
								{#if $localLoginSubmitting}<Loader2 class="mr-2 size-4 animate-spin" />Signing in…{:else}Sign
									in{/if}
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
									Self-custody sign-in: enter your <code>did:syr</code> and approve on the device that
									holds your key. No password is stored here.
								</p>
							</div>
							{#if !synerChallenge}
								<label class="space-y-1.5">
									<span class="text-sm font-medium">Your DID</span>
									<Input
										type="text"
										inputmode="url"
										placeholder="did:syr:…"
										autocapitalize="off"
										autocorrect="off"
										spellcheck={false}
										bind:value={synerDid}
										disabled={synerStarting}
									/>
								</label>
								{#if errorMsg}<p class="text-sm text-destructive">{errorMsg}</p>{/if}
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
								<Input
									type="text"
									autocapitalize="off"
									placeholder="your_handle"
									bind:value={importUsername}
									disabled={importing}
								/>
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
							{#if errorMsg}<p class="text-sm text-destructive">{errorMsg}</p>{/if}
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
						<p class="rounded-md border border-border bg-muted/50 p-3 text-center text-sm text-muted-foreground">
							Registration is closed on this instance.
						</p>
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
											autocapitalize="off"
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
									At least 8 characters with an uppercase letter, a lowercase letter, and a number.
									It also protects your identity's signing key.
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
							{#if errorMsg}
								<p class="text-sm text-destructive">{errorMsg}</p>
							{/if}
							<Form.Button class="mt-auto w-full" disabled={$localRegisterSubmitting}>
								{#if $localRegisterSubmitting}<Loader2 class="mr-2 size-4 animate-spin" />Creating
									identity…{:else}Create account{/if}
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

			<button
				type="button"
				class="w-full text-xs text-muted-foreground hover:text-foreground"
				onclick={() => goto('/setup')}
			>
				Change API host
			</button>
		</div>
	{/if}
</div>
