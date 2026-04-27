<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listen } from '@tauri-apps/api/event';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Label } from '@syren/ui/label';
	import { getStoredHostSync } from '$lib/host-store';
	import { getNativeClient } from '$lib/client';
	import { syncSessionFromTauri } from '$lib/session-bridge';
	import { api } from '@syren/app-core/api';
	import { normalizeHost, isValidHost } from '@syren/app-core/normalize-host';
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

	let instanceUrl = $state('');
	let loading = $state(false);
	/** True from the moment the system browser opens until the OAuth
	 *  round-trip resolves (auth-changed / auth-error) or times out. */
	let signingIn = $state(false);
	let errorMsg = $state<string | null>(null);

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
		// The Rust OAuth flow stores the session in the Tauri Store; the
		// WASM api.auth.me() reads from localStorage. Mirror the former
		// to the latter before each check so a successful Rust-side
		// login is visible to the JS-side client.
		const apiHost = getStoredHostSync();
		if (apiHost) await syncSessionFromTauri(apiHost);
		try {
			await api.auth.me();
			if (import.meta.env.DEV) console.log(`[login] self-correct: /auth/me succeeded (${reason})`);
			redirected = true;
			stopPolling();
			clearPendingOAuth();
			signingIn = false;
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

	onMount(() => {
		// Restore in-flight OAuth state if the WebView was killed while
		// the user was in the system browser. Without this, returning to
		// the app shows a fresh empty form for several seconds before
		// polling discovers the session — looks like the app hung.
		const pending = readPendingOAuth();
		if (pending) {
			instanceUrl = pending.instance_url;
			signingIn = true;
			startPolling();
		}

		void (async () => {
			unlisten = await listen<unknown>('auth-changed', async (event) => {
				if (import.meta.env.DEV) console.log('[login] auth-changed authed=', !!event.payload);
				if (!event.payload) return;
				// Mirror the freshly-persisted Tauri-store session into
				// localStorage so the (app) layout's checkAuth() — which
				// goes through the WASM client — actually finds a session
				// instead of bouncing back to /login.
				const apiHost = getStoredHostSync();
				if (apiHost) await syncSessionFromTauri(apiHost);
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
				loading = false;
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
		unlisten?.();
		unlistenError?.();
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('focus', onFocus);
		stopPolling();
	});

	async function handleSyrLogin(e: SubmitEvent) {
		e.preventDefault();
		const normalized = normalizeHost(instanceUrl);
		if (!normalized) return;
		if (!isValidHost(normalized)) {
			errorMsg = "That doesn't look like a valid URL.";
			return;
		}
		instanceUrl = normalized;

		const apiHost = getStoredHostSync();
		if (!apiHost) {
			errorMsg = 'API host not configured.';
			return;
		}
		loading = true;
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
			// The OS routes that into Tauri; the deep-link handler fires
			// `complete_login` → `syren-client::login_complete`, which
			// fetches `/auth/me` and emits `auth-changed`. The listener
			// above handles the navigation into the app.
			await getNativeClient(apiHost).startLogin(normalized);
			signingIn = true;
			// Poll `/auth/me` while the user is in the system browser.
			// If `auth-changed` is missed (event not buffered, fired
			// before our listener attached, etc.) the next poll catches
			// the persisted session and routes us into the app anyway.
			startPolling();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Connection failed';
			clearPendingOAuth();
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
	{#if signingIn}
		<!-- Persistent "completing sign-in" UI. Stays visible while the
		     user is in the system browser AND while we're waiting for
		     either the auth-changed deep-link callback or the polling
		     fallback to land. Without this, returning to the app showed
		     a fresh empty form for several seconds — felt like the app
		     had hung. -->
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
			{#if instanceUrl}
				<p class="font-mono text-xs text-muted-foreground">{instanceUrl}</p>
			{/if}
			{#if errorMsg}
				<p class="text-sm text-destructive">{errorMsg}</p>
			{/if}
			<Button type="button" variant="ghost" size="sm" class="w-full" onclick={cancelSigningIn}>
				Cancel and try again
			</Button>
		</div>
	{:else}
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
				{#if loading}<Loader2 class="mr-2 size-4 animate-spin" />Opening browser…{:else}Continue{/if}
			</Button>
			<button
				type="button"
				class="w-full text-xs text-muted-foreground hover:text-foreground"
				onclick={() => goto('/setup')}
			>
				Change API host
			</button>
		</form>
	{/if}
</div>
