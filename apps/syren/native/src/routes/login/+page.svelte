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
	import { normalizeHost, isValidHost } from '$lib/normalize-host';
	import { Loader2 } from '@lucide/svelte';

	let instanceUrl = $state('');
	let loading = $state(false);
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

	// The Rust side fires `auth-changed` once it consumes the
	// `syren://auth/callback?code=...` deep link and exchanges the
	// bridge code for a session. We listen here and route into the
	// app the moment that lands. Listener registration lives inside
	// `onMount` so it's synchronised with the component lifecycle —
	// otherwise an early-destroy could fire `unlisten?.()` while the
	// `listen()` promise is still resolving and the unlisten fn is
	// `undefined`.
	let unlisten: (() => void) | undefined;
	let unlistenError: (() => void) | undefined;

	// Belt and braces: the `auth-changed` event isn't buffered, so if
	// the WebView was paused while the user was in the system browser,
	// or if the deep-link callback fired before our `listen()` finished
	// resolving, we'd miss it and stay stuck on /login despite the
	// session being persisted to the Tauri store. Re-poll `/auth/me`
	// any time the app comes back into the foreground (visibility +
	// focus events), and a short interval right after the user kicks
	// off OAuth — the moment we see a valid session, route into the app.
	let polling: ReturnType<typeof setInterval> | undefined;
	let pollingTimeout: ReturnType<typeof setTimeout> | undefined;
	let redirected = false;

	async function checkAndRedirect(reason: string) {
		if (redirected) return;
		const apiHost = getStoredHostSync();
		if (!apiHost) return;
		try {
			await getNativeClient(apiHost).me();
			if (import.meta.env.DEV) console.log(`[login] self-correct: /auth/me succeeded (${reason})`);
			redirected = true;
			if (polling) clearInterval(polling);
			if (pollingTimeout) clearTimeout(pollingTimeout);
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

	onMount(() => {
		// Listener registration is fire-and-forget; the listen() promises
		// resolve to unlisten fns we capture once available. onDestroy
		// guards on `unlisten?.()` so a destroy before resolution is safe.
		void (async () => {
			unlisten = await listen<unknown>('auth-changed', (event) => {
				if (import.meta.env.DEV) console.log('[login] auth-changed authed=', !!event.payload);
				if (event.payload) {
					goto('/channels/@me', { replaceState: true });
				}
			});
			unlistenError = await listen<string>('auth-error', (event) => {
				if (import.meta.env.DEV) console.log('[login] auth-error', event.payload);
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
		if (polling) clearInterval(polling);
		if (pollingTimeout) clearTimeout(pollingTimeout);
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
			// Rust opens the consent URL in the system browser. After the
			// user completes consent, syr.is redirects to our API
			// callback, which bounces to `syren://auth/callback?code=...`.
			// The OS routes that into Tauri; the deep-link handler fires
			// `complete_login` → `syren-client::login_complete`, which
			// fetches `/auth/me` and emits `auth-changed`. The listener
			// above handles the navigation into the app.
			await getNativeClient(apiHost).startLogin(normalized);
			// Poll `/auth/me` while the user is in the system browser.
			// If `auth-changed` is missed (event not buffered, fired
			// before our listener attached, etc.) the next poll catches
			// the persisted session and routes us into the app anyway.
			// Stops automatically once a redirect fires or after 2 min.
			if (polling) clearInterval(polling);
			if (pollingTimeout) clearTimeout(pollingTimeout);
			polling = setInterval(() => void checkAndRedirect('poll'), 1500);
			pollingTimeout = setTimeout(() => {
				if (polling) {
					clearInterval(polling);
					polling = undefined;
				}
				pollingTimeout = undefined;
			}, 120_000);
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
