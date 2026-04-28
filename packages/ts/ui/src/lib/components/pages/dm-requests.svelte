<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { Check, X, Clock, Search, Loader2, UserPlus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { FriendSendInputSchema } from '@syren/types';
	import { api } from '@syren/app-core/api';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { formatAgo } from '@syren/app-core/utils/date';

	const relations = getRelations();
	// Incoming + outgoing request lists. `relations.ignored` hides ignored-user
	// incoming requests from the main view; they live in /ignored.
	const incoming = $derived(
		[...relations.incoming.entries()]
			.filter(([did]) => !relations.isIgnored(did))
			.map(([did, meta]) => ({ did, created_at: meta.created_at }))
	);
	const outgoing = $derived(
		[...relations.outgoing.entries()].map(([did, meta]) => ({ did, created_at: meta.created_at }))
	);

	async function accept(did: string) {
		try {
			await api.relations.accept(did);
			toast.success('Friend added');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	async function decline(did: string) {
		try {
			await api.relations.decline(did);
			toast.success('Request declined');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	async function cancel(did: string) {
		try {
			await api.relations.cancelOrRemove(did);
			toast.success('Request cancelled');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	// ── Send request by DID / handle ──
	type SendMode = 'handle' | 'did';
	let sendMode = $state<SendMode>('handle');
	let sendResolved = $state<{ did: string; syr_instance_url: string | null; registered: boolean } | null>(null);
	let sendResolvedQuery = $state<string | null>(null);
	let sending = $state(false);

	const sendProfile = $derived(
		sendResolved ? resolveProfile(sendResolved.did, sendResolved.syr_instance_url ?? undefined) : null
	);
	const sendName = $derived(
		sendResolved && sendProfile ? displayName(sendProfile, sendResolved.did) : null
	);
	const sendHandle = $derived(
		sendResolved && sendProfile ? federatedHandle(sendProfile, sendResolved.did) : null
	);

	// Like dm-index: validates the search-input format on the frontend.
	// The actual `friend send` body is validated against the generated
	// `FriendSendInputSchema` at send time (see `sendRequest`).
	function makeSendSchema(m: SendMode) {
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

	let SendSchema = $state(makeSendSchema('handle'));
	$effect(() => {
		SendSchema = makeSendSchema(sendMode);
	});

	function buildSendQuery(input: string): string {
		const v = input.trim();
		if (!v) return '';
		if (sendMode === 'did') return v.startsWith('did:syr:') ? v : `did:syr:${v}`;
		return v;
	}

	const sendForm = superForm(defaults(zod4(SendSchema)), {
		SPA: true,
		validators: zod4Client(SendSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			const q = buildSendQuery(f.data.identifier);
			if (sendResolved && sendResolved.registered && sendResolvedQuery === q) {
				await sendRequest();
				return;
			}
			sendResolved = null;
			sendResolvedQuery = null;
			try {
				sendResolved = await api.users.resolve(q);
				sendResolvedQuery = q;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Could not find user');
			}
		}
	});
	const { form: sendFormData, enhance: sendEnhance, submitting: sendSubmitting } = sendForm;

	function switchSendMode(next: SendMode) {
		sendMode = next;
		$sendFormData.identifier = '';
		sendResolved = null;
		sendResolvedQuery = null;
	}

	// Drop the stale resolution as soon as the input drifts from the
	// query that produced it.
	$effect(() => {
		if (sendResolved && buildSendQuery($sendFormData.identifier) !== sendResolvedQuery) {
			sendResolved = null;
			sendResolvedQuery = null;
		}
	});

	async function sendRequest() {
		if (!sendResolved || sending) return;
		if (!sendResolved.registered) {
			toast.error("This user hasn't joined Syren yet");
			return;
		}
		// Validate the body against the canonical Rust-derived schema.
		const parsed = FriendSendInputSchema.safeParse({
			user_id: sendResolved.did,
			syr_instance_url: sendResolved.syr_instance_url ?? undefined
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid request');
			return;
		}
		sending = true;
		try {
			await api.relations.sendRequest(parsed.data.user_id, parsed.data.syr_instance_url);
			toast.success('Friend request sent');
			sendResolved = null;
			sendResolvedQuery = null;
			$sendFormData.identifier = '';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to send request');
		}
		sending = false;
	}

</script>

<div class="flex h-12 shrink-0 items-center border-b border-border px-4">
	<h1 class="text-sm font-semibold">Friend requests</h1>
</div>

<main class="flex-1 overflow-y-auto">
	<div class="mx-auto max-w-3xl space-y-6 p-6">
		<!-- Send request by DID / handle -->
		<section class="space-y-3">
			<h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Send a friend request
			</h2>
			<form method="POST" use:sendEnhance class="space-y-2">
				<!-- Mode switcher -->
				<div class="flex gap-1">
					{#each [['handle', 'Handle (user@instance)'], ['did', 'DID']] as [k, label] (k)}
						{@const active = sendMode === k}
						<button
							type="button"
							onclick={() => switchSendMode(k as SendMode)}
							class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
								{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
						>
							{label}
						</button>
					{/each}
				</div>
				<Form.Field form={sendForm} name="identifier">
					<div class="flex gap-2">
						<Form.Control>
							{#snippet children({ props })}
								<Input
									{...props}
									bind:value={$sendFormData.identifier}
									placeholder={sendMode === 'handle' ? 'alice@syr.example.com' : 'did:syr:…'}
									disabled={$sendSubmitting || sending}
									class="flex-1 font-mono text-sm"
								/>
							{/snippet}
						</Form.Control>
						<Button type="submit" variant="outline" disabled={$sendSubmitting || sending}>
							{#if $sendSubmitting}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else}
								<Search class="h-4 w-4" />
							{/if}
						</Button>
					</div>
					<Form.Description class="text-[11px]">
						{#if sendMode === 'handle'}
							Resolved against the user's syr instance.
						{:else}
							Exact DID of the target user.
						{/if}
					</Form.Description>
					<Form.FieldErrors />
				</Form.Field>
				{#if sendResolved}
					<div class="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
						{#if sendProfile}
							<Avatar.Root class="h-9 w-9 shrink-0">
								{#if sendProfile.avatar_url}
									<Avatar.Image src={proxied(sendProfile.avatar_url)} alt={sendName ?? ''} />
								{/if}
								<Avatar.Fallback class="text-xs">
									{(sendName ?? '?').slice(0, 2).toUpperCase()}
								</Avatar.Fallback>
							</Avatar.Root>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{sendName ?? sendResolved.did.slice(0, 20)}</p>
							{#if sendHandle}
								<p class="truncate font-mono text-[11px] text-muted-foreground">{sendHandle}</p>
							{/if}
						</div>
						{#if !sendResolved.registered}
							<span
								class="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
							>
								Not on Syren
							</span>
						{/if}
						<Button
							type="button"
							size="sm"
							disabled={!sendResolved.registered || sending}
							onclick={sendRequest}
						>
							{#if sending}
								<Loader2 class="mr-1 h-3 w-3 animate-spin" />
							{:else}
								<UserPlus class="mr-1 h-3 w-3" />
							{/if}
							Send
						</Button>
					</div>
				{/if}
			</form>
		</section>

		<section>
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Incoming · {incoming.length}
			</h2>
			{#if incoming.length === 0}
				<p class="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
					No incoming requests.
				</p>
			{:else}
				<div class="space-y-1">
					{#each incoming as r (r.did)}
						{@const profile = resolveProfile(r.did, relations.instanceFor(r.did))}
						{@const name = displayName(profile, r.did)}
						<div class="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
							<Avatar.Root class="h-9 w-9 shrink-0">
								{#if profile.avatar_url}
									<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
								{/if}
								<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{name}</p>
								<p class="truncate font-mono text-[11px] text-muted-foreground">
									{federatedHandle(profile, r.did)} · {formatAgo(r.created_at)}
								</p>
							</div>
							<button
								type="button"
								onclick={() => accept(r.did)}
								title="Accept"
								class="rounded p-1.5 text-green-500 hover:bg-green-500/15"
							>
								<Check class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => decline(r.did)}
								title="Decline"
								class="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Outgoing · {outgoing.length}
			</h2>
			{#if outgoing.length === 0}
				<p class="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
					No pending outgoing requests.
				</p>
			{:else}
				<div class="space-y-1">
					{#each outgoing as r (r.did)}
						{@const profile = resolveProfile(r.did, relations.instanceFor(r.did))}
						{@const name = displayName(profile, r.did)}
						<div class="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
							<Avatar.Root class="h-9 w-9 shrink-0">
								{#if profile.avatar_url}
									<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
								{/if}
								<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{name}</p>
								<p class="truncate font-mono text-[11px] text-muted-foreground">
									<Clock class="inline h-3 w-3" />
									{federatedHandle(profile, r.did)} · {formatAgo(r.created_at)}
								</p>
							</div>
							<button
								type="button"
								onclick={() => cancel(r.did)}
								title="Cancel request"
								class="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</main>
