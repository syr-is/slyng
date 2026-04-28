<script lang="ts">
	import { MessageSquare, Search, Loader2 } from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { CreateDmInputSchema } from '@syren/types';
	import { api } from '@syren/app-core/api';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	type Mode = 'handle' | 'did';
	let mode = $state<Mode>('handle');
	let resolved = $state<{ did: string; syr_instance_url: string | null; registered: boolean } | null>(null);
	let starting = $state(false);

	const resolvedProfile = $derived(
		resolved ? resolveProfile(resolved.did, resolved.syr_instance_url ?? undefined) : null
	);
	const resolvedName = $derived(
		resolved && resolvedProfile ? displayName(resolvedProfile, resolved.did) : null
	);
	const resolvedHandle = $derived(
		resolved && resolvedProfile ? federatedHandle(resolvedProfile, resolved.did) : null
	);

	// Local schema validates the *search input* shape — DIDs must start
	// with `did:`, handles must contain `@`. The actual `createDM` body
	// is validated against the generated `CreateDmInputSchema` at send
	// time (see `startDm`).
	function makeSearchSchema(m: Mode) {
		return z.object({
			identifier: z
				.string()
				.min(1, m === 'handle' ? 'Enter a handle' : 'Enter a DID')
				.refine(
					(v) => {
						const t = v.trim();
						if (!t) return false;
						if (m === 'did') return t.startsWith('did:syr:') || /^did:[^:]+:.+/.test(t);
						const at = t.indexOf('@');
						return at > 0 && at < t.length - 1;
					},
					{ message: m === 'did' ? 'Expected a DID like did:syr:…' : 'Expected handle@instance.host' }
				)
		});
	}

	// Re-build the form when the mode changes so the refine message
	// reflects the active mode.
	let SearchSchema = $state(makeSearchSchema('handle'));
	$effect(() => {
		SearchSchema = makeSearchSchema(mode);
	});

	const form = superForm(defaults(zod4(SearchSchema)), {
		SPA: true,
		validators: zod4Client(SearchSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			// If we already have a resolved + registered user matching the
			// current input, fall through to opening the DM. Otherwise
			// resolve.
			const t = f.data.identifier.trim();
			const q = mode === 'did' && !t.startsWith('did:syr:') ? `did:syr:${t}` : t;
			if (resolved && resolved.registered) {
				await startDm();
				return;
			}
			resolved = null;
			try {
				resolved = await api.users.resolve(q);
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Could not find user');
			}
		}
	});
	const { form: formData, enhance, submitting } = form;

	function switchMode(next: Mode) {
		mode = next;
		$formData.identifier = '';
		resolved = null;
	}

	async function startDm() {
		if (!resolved || starting) return;
		if (!resolved.registered) {
			toast.error("This user hasn't joined Syren yet");
			return;
		}
		// Validate the body against the canonical Rust-derived schema
		// before the call. With trivial fields it's belt-and-suspenders,
		// but it documents the wire contract.
		const parsed = CreateDmInputSchema.safeParse({
			recipient_id: resolved.did,
			syr_instance_url: resolved.syr_instance_url ?? undefined
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid request');
			return;
		}
		starting = true;
		try {
			const ch = await api.users.createDM(parsed.data.recipient_id, parsed.data.syr_instance_url);
			goto(`/channels/@me/${ch.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to open DM');
		}
		starting = false;
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

	<form method="POST" use:enhance class="flex w-full max-w-md flex-col gap-3">
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

		<Form.Field {form} name="identifier">
			<div class="flex gap-2">
				<Form.Control>
					{#snippet children({ props })}
						<Input
							{...props}
							bind:value={$formData.identifier}
							placeholder={mode === 'handle' ? 'alice@syr.example.com' : 'did:syr:…'}
							disabled={$submitting || starting}
							class="flex-1 font-mono text-sm"
						/>
					{/snippet}
				</Form.Control>
				<Button type="submit" variant="outline" disabled={$submitting || starting}>
					{#if $submitting}
						<Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						<Search class="h-4 w-4" />
					{/if}
				</Button>
			</div>
			<Form.Description class="text-[11px]">
				{#if mode === 'handle'}
					Resolved against the user's syr instance.
				{:else}
					Exact DID of the target user.
				{/if}
			</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Resolved preview -->
		{#if resolved}
			<div class="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
				{#if resolvedProfile}
					<Avatar.Root class="h-10 w-10">
						{#if resolvedProfile.avatar_url}
							<Avatar.Image src={proxied(resolvedProfile.avatar_url)} alt={resolvedName ?? ''} />
						{/if}
						<Avatar.Fallback class="text-xs">
							{(resolvedName ?? '?').slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{resolvedName ?? resolved.did.slice(0, 20)}</p>
					{#if resolvedHandle}
						<p class="truncate font-mono text-[11px] text-muted-foreground">{resolvedHandle}</p>
					{/if}
				</div>
				{#if !resolved.registered}
					<span
						class="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
					>
						Not on Syren
					</span>
				{/if}
			</div>

			<Button
				type="button"
				disabled={!resolved.registered || starting}
				onclick={startDm}
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
