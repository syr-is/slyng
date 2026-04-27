<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listen } from '@tauri-apps/api/event';
	import { api } from '@syren/app-core/api';

	const OAUTH_STATE_KEY = 'syren_oauth_state';

	let unlisten: (() => void) | undefined;
	let pollHandle: ReturnType<typeof setInterval> | undefined;
	let pollTimeout: ReturnType<typeof setTimeout> | undefined;
	let resolved = false;

	function hasPendingOAuth(): boolean {
		if (typeof localStorage === 'undefined') return false;
		const raw = localStorage.getItem(OAUTH_STATE_KEY);
		if (!raw) return false;
		try {
			const p = JSON.parse(raw) as { started_at?: number };
			return !!p.started_at && Date.now() - p.started_at < 5 * 60 * 1000;
		} catch {
			return false;
		}
	}

	function done(target: '/channels/@me' | '/login') {
		if (resolved) return;
		resolved = true;
		if (pollHandle) clearInterval(pollHandle);
		if (pollTimeout) clearTimeout(pollTimeout);
		unlisten?.();
		goto(target, { replaceState: true });
	}

	async function tryMe() {
		try {
			await api.auth.me();
			done('/channels/@me');
		} catch {
			/* still unauthenticated */
		}
	}

	onMount(async () => {
		// First check is always the cheapest one — most warm-start sessions
		// already have a valid bearer in the store, so this resolves before
		// the listener / poll machinery ever runs.
		try {
			await api.auth.me();
			done('/channels/@me');
			return;
		} catch {
			/* fall through to OAuth-pending check */
		}

		// Cold-start case: deep-link delivery may have re-launched the
		// WebView while `login_complete` was still in flight on the Rust
		// side. Bouncing to /login here would just bounce again to /@me a
		// moment later (a visible flash). Wait in place for the
		// `auth-changed` event — or `/auth/me` to start succeeding — and
		// jump straight to /@me when it does.
		if (hasPendingOAuth()) {
			unlisten = await listen<unknown>('auth-changed', (event) => {
				if (event.payload) done('/channels/@me');
			});
			pollHandle = setInterval(() => void tryMe(), 1500);
			pollTimeout = setTimeout(() => done('/login'), 30_000);
			return;
		}

		done('/login');
	});

	onDestroy(() => {
		if (pollHandle) clearInterval(pollHandle);
		if (pollTimeout) clearTimeout(pollTimeout);
		unlisten?.();
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-background">
	<p class="text-sm text-muted-foreground">Connecting…</p>
</div>
