<script lang="ts">
	import { MessageSquare, Search, Loader2 } from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '@syren/app-core/api';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	type Mode = 'handle' | 'did';
	let mode = $state<Mode>('handle');
	let inputValue = $state('');
	let resolving = $state(false);
	let resolved = $state<{ did: string; syr_instance_url: string | null; registered: boolean } | null>(null);
	let starting = $state(false);

	function switchMode(next: Mode) {
		mode = next;
		inputValue = '';
		resolved = null;
	}

	const resolvedProfile = $derived(
		resolved ? resolveProfile(resolved.did, resolved.syr_instance_url ?? undefined) : null
	);
	const resolvedName = $derived(
		resolved && resolvedProfile ? displayName(resolvedProfile, resolved.did) : null
	);
	const resolvedHandle = $derived(
		resolved && resolvedProfile ? federatedHandle(resolvedProfile, resolved.did) : null
	);

	function buildQuery(): string {
		const v = inputValue.trim();
		if (!v) return '';
		if (mode === 'did') return v.startsWith('did:syr:') ? v : `did:syr:${v}`;
		return v;
	}

	async function handleResolve() {
		const q = buildQuery();
		if (!q) return;
		resolved = null;
		resolving = true;
		try {
			resolved = await api.users.resolve(q);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not find user');
		}
		resolving = false;
	}

	async function startDm() {
		if (!resolved || starting) return;
		if (!resolved.registered) {
			toast.error("This user hasn't joined Syren yet");
			return;
		}
		starting = true;
		try {
			const ch = await api.users.createDM(resolved.did, resolved.syr_instance_url ?? undefined);
			goto(`/channels/@me/${ch.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to open DM');
		}
		starting = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (resolved?.registered) startDm();
			else handleResolve();
		}
	}
</script>

<div class="flex h-full flex-col items-center justify-center gap-6 p-8">
	<div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
		<MessageSquare class="h-8 w-8 text-muted-foreground" />
	</div>
	<div class="text-center">
		<p class="text-lg font-medium text-foreground">Start a conversation</p>
		<p class="mt-1 text-sm text-muted-foreground">
			Find someone by their handle or DID to start a direct message.
		</p>
	</div>

	<form
		onsubmit={(e) => { e.preventDefault(); if (resolved?.registered) startDm(); else handleResolve(); }}
		class="flex w-full max-w-md flex-col gap-3"
	>
		<!-- Mode switcher -->
		<div class="flex gap-1">
			{#each [['handle', 'Handle (user@instance)'], ['did', 'DID']] as [k, label] (k)}
				{@const active = mode === k}
				<button
					type="button"
					onclick={() => switchMode(k as Mode)}
					class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
						{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
				>
					{label}
				</button>
			{/each}
		</div>

		<!-- Input -->
		<div class="flex gap-2">
			{#if mode === 'handle'}
				<Input
					bind:value={inputValue}
					onkeydown={handleKeydown}
					placeholder="alice@syr.example.com"
					disabled={resolving || starting}
					class="flex-1 font-mono text-sm"
				/>
			{:else}
				<Input
					bind:value={inputValue}
					onkeydown={handleKeydown}
					placeholder="did:syr:…"
					disabled={resolving || starting}
					class="flex-1 font-mono text-sm"
				/>
			{/if}
			<Button
				type="button"
				variant="outline"
				disabled={!inputValue.trim() || resolving}
				onclick={handleResolve}
			>
				{#if resolving}
					<Loader2 class="h-4 w-4 animate-spin" />
				{:else}
					<Search class="h-4 w-4" />
				{/if}
			</Button>
		</div>

		{#if mode === 'handle'}
			<p class="text-[11px] text-muted-foreground">Resolved against the user's syr instance.</p>
		{:else}
			<p class="text-[11px] text-muted-foreground">Exact DID of the target user.</p>
		{/if}

		<!-- Resolved preview -->
		{#if resolved}
			<div class="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
				{#if resolvedProfile}
					<Avatar.Root class="h-10 w-10">
						{#if resolvedProfile.avatar_url}
							<Avatar.Image src={proxied(resolvedProfile.avatar_url)} alt={resolvedName ?? ''} />
						{/if}
						<Avatar.Fallback class="text-xs">{(resolvedName ?? '?').slice(0, 2).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{resolvedName ?? resolved.did.slice(0, 20)}</p>
					{#if resolvedHandle}
						<p class="truncate font-mono text-[11px] text-muted-foreground">{resolvedHandle}</p>
					{/if}
				</div>
				{#if !resolved.registered}
					<span class="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
						Not on Syren
					</span>
				{/if}
			</div>

			<Button
				type="submit"
				disabled={!resolved.registered || starting}
				class="w-full"
			>
				{#if starting}
					<Loader2 class="mr-1.5 h-4 w-4 animate-spin" />
					Opening…
				{:else if !resolved.registered}
					User hasn't joined Syren yet
				{:else}
					<MessageSquare class="mr-1.5 h-4 w-4" />
					Send message
				{/if}
			</Button>
		{/if}
	</form>
</div>
