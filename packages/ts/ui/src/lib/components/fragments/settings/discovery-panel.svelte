<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import * as Dialog from '@syren/ui/dialog';
	import {
		Loader2,
		Plus,
		Trash2,
		RefreshCw,
		RotateCcw,
		X,
		Globe,
		CheckCircle2,
		AlertCircle,
		Clock
	} from '@lucide/svelte';
	import {
		getRegistryState,
		loadRegistries,
		addRegistry,
		removeRegistry,
		syncRegistries,
		retryOutboxJob,
		cancelOutboxJob
	} from '@syren/app-core/stores/registry.svelte';
	import type { OwnedOutboxJob, OwnedRegistry } from '@syren/types';

	/**
	 * Discovery registries (P9): the registries this identity announces its
	 * hosting to. Adding one queues a root-signed hosting record; "Sync" takes
	 * the account password to sign + push server-side. A background poller
	 * redelivers signed-but-undelivered jobs, so statuses settle on their own.
	 */
	const reg = getRegistryState();

	let newUrl = $state('');
	let busy = $state(false);
	let adding = $state(false);
	let syncOpen = $state(false);
	let password = $state('');
	let syncing = $state(false);

	onMount(() => {
		void loadRegistries().catch(() => {});
	});

	async function add() {
		const url = newUrl.trim();
		if (!url || adding) return;
		adding = true;
		try {
			await addRegistry(url);
			newUrl = '';
			toast.success('Registry added — Sync to announce your hosting.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add registry');
		}
		adding = false;
	}

	async function remove(r: OwnedRegistry) {
		if (busy) return;
		busy = true;
		try {
			await removeRegistry(r.id);
			toast.success('Registry removed — Sync to push the takedown.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to remove registry');
		}
		busy = false;
	}

	async function doSync() {
		if (!password || syncing) return;
		syncing = true;
		try {
			const res = await syncRegistries(password);
			password = '';
			syncOpen = false;
			toast.success(
				`Synced: ${res.delivered} delivered, ${res.signed} signed${res.failed ? `, ${res.failed} failed` : ''}.`
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Sync failed');
		}
		syncing = false;
	}

	async function retry(j: OwnedOutboxJob) {
		try {
			await retryOutboxJob(j.id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to requeue');
		}
	}
	async function cancel(j: OwnedOutboxJob) {
		try {
			await cancelOutboxJob(j.id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to cancel');
		}
	}

	const activeJobs = $derived(reg.outbox.filter((j) => j.status !== 'completed'));

	function regBadge(status: OwnedRegistry['status']) {
		if (status === 'synced') return { Icon: CheckCircle2, cls: 'text-green-600', label: 'Synced' };
		if (status === 'error') return { Icon: AlertCircle, cls: 'text-destructive', label: 'Error' };
		return { Icon: Clock, cls: 'text-muted-foreground', label: 'Pending' };
	}
	function fmt(iso: string | null): string {
		return iso ? new Date(iso).toLocaleString() : '—';
	}
</script>

<div class="space-y-6">
	<div>
		<div class="flex items-start justify-between gap-3">
			<div>
				<h1 class="text-xl font-semibold">Discovery registries</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Announce that your identity is hosted here so others can find and follow you across
					instances. Each announcement is signed with your identity key — <b>Sync</b> asks for your
					password to sign and publish.
				</p>
			</div>
			<Button size="sm" disabled={reg.registries.length === 0} onclick={() => (syncOpen = true)}>
				<RefreshCw class="mr-1.5 size-4" /> Sync
			</Button>
		</div>
	</div>

	<!-- Add -->
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void add();
		}}
	>
		<input
			bind:value={newUrl}
			aria-label="Registry URL"
			placeholder="https://registry.example.com"
			class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
		/>
		<Button type="submit" size="sm" disabled={adding || !newUrl.trim()}>
			{#if adding}<Loader2 class="mr-1.5 size-4 animate-spin" />{:else}<Plus class="mr-1.5 size-4" />{/if}
			Add
		</Button>
	</form>

	<!-- Registry list -->
	<div class="space-y-2">
		{#if !reg.loaded}
			<div class="flex justify-center py-6 text-muted-foreground">
				<Loader2 class="size-5 animate-spin" />
			</div>
		{:else if reg.registries.length === 0}
			<p class="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
				No registries yet. Add one above to be discoverable.
			</p>
		{:else}
			{#each reg.registries as r (r.id)}
				{@const b = regBadge(r.status)}
				<div class="flex items-center gap-3 rounded-md border border-border px-3 py-2">
					<Globe class="size-4 shrink-0 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{r.registry_url}</p>
						<p class="text-xs text-muted-foreground">Last synced: {fmt(r.last_synced_at)}</p>
					</div>
					<span class="inline-flex items-center gap-1 text-xs {b.cls}">
						<b.Icon class="size-3.5" />{b.label}
					</span>
					<button
						type="button"
						class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
						title="Remove"
						disabled={busy}
						onclick={() => remove(r)}
					>
						<Trash2 class="size-4" />
					</button>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Outbox -->
	{#if activeJobs.length > 0}
		<div class="space-y-2">
			<p class="text-sm font-medium">Pending announcements</p>
			{#each activeJobs as j (j.id)}
				<div class="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
					<span class="rounded bg-muted px-1.5 py-0.5 font-medium uppercase">{j.action}</span>
					<div class="min-w-0 flex-1">
						<p class="truncate">{j.registry_url}</p>
						{#if j.last_error}
							<p class="truncate text-destructive">{j.last_error}</p>
						{/if}
					</div>
					<span class="whitespace-nowrap text-muted-foreground">
						{j.status}{j.attempts ? ` · ${j.attempts}/${j.max_attempts}` : ''}
					</span>
					{#if j.status === 'failed' || j.status === 'pending'}
						<button
							type="button"
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Retry"
							onclick={() => retry(j)}
						>
							<RotateCcw class="size-3.5" />
						</button>
					{/if}
					<button
						type="button"
						class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Cancel"
						onclick={() => cancel(j)}
					>
						<X class="size-3.5" />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Password prompt for signing -->
<Dialog.Root bind:open={syncOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Sync registries</Dialog.Title>
			<Dialog.Description>
				Your password unlocks your identity key to sign and publish your hosting records. It is used
				once and never stored.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-3"
			onsubmit={(e) => {
				e.preventDefault();
				void doSync();
			}}
		>
			<input
				type="password"
				bind:value={password}
				placeholder="Account password"
				autocomplete="current-password"
				class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
			/>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={() => (syncOpen = false)}>Cancel</Button>
				<Button type="submit" size="sm" disabled={syncing || !password}>
					{#if syncing}<Loader2 class="mr-1.5 size-4 animate-spin" />{/if}
					Sign &amp; publish
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
