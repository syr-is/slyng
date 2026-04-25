<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { api } from '@syren/app-core/api';

	const {
		serverId,
		onCreated
	}: {
		serverId: string;
		onCreated: () => void;
	} = $props();

	type Scope = 'open' | 'instance' | 'did';
	type UserMode = 'did' | 'handle';

	let label = $state('');
	let scope = $state<Scope>('open');
	let userMode = $state<UserMode>('handle');
	let targetValue = $state('');
	let maxUses = $state('0');
	let expiresIn = $state('0');
	let submitting = $state(false);

	const scopeLabels: Record<Scope, string> = {
		open: 'Anyone',
		instance: 'Instance',
		did: 'Single user'
	};

	async function submit() {
		const max = parseInt(maxUses, 10);
		const exp = parseInt(expiresIn, 10);
		const raw = targetValue.trim();

		// Client-side shape validation for the 'did' scope
		if (scope === 'did') {
			if (userMode === 'did' && !raw.startsWith('did:')) {
				toast.error('Expected a DID starting with `did:`');
				return;
			}
			if (userMode === 'handle') {
				const at = raw.indexOf('@');
				if (at <= 0 || at === raw.length - 1) {
					toast.error('Expected `handle@instance.host`');
					return;
				}
			}
		}

		submitting = true;
		try {
			await api.servers.createInvite(serverId, {
				max_uses: Number.isFinite(max) ? max : 0,
				expires_in: Number.isFinite(exp) && exp > 0 ? exp : undefined,
				target_kind: scope,
				target_value: scope === 'open' ? undefined : raw || undefined,
				label: label.trim() || undefined
			});
			toast.success('Invite created');
			label = '';
			targetValue = '';
			onCreated();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create invite');
		}
		submitting = false;
	}
</script>

<form
	onsubmit={(e) => { e.preventDefault(); void submit(); }}
	class="rounded-lg border border-border bg-card p-4 space-y-3"
>
	<p class="text-sm font-medium">Create a new invite</p>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Label (optional)</label>
			<Input bind:value={label} placeholder="e.g. 'for alice'" />
		</div>
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Scope</label>
			<div class="flex gap-1">
				{#each ['open', 'instance', 'did'] as k (k)}
					{@const active = scope === k}
					<button
						type="button"
						onclick={() => (scope = k as Scope)}
						class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
							{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
					>
						{scopeLabels[k as Scope]}
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if scope === 'instance'}
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Instance host</label>
			<Input bind:value={targetValue} placeholder="syr.example.com" />
			<p class="text-[11px] text-muted-foreground">Only users whose syr instance hostname matches this can join.</p>
		</div>
	{:else if scope === 'did'}
		<div class="space-y-2">
			<div class="flex gap-1">
				{#each ['handle', 'did'] as m (m)}
					{@const active = userMode === m}
					<button
						type="button"
						onclick={() => { userMode = m as UserMode; targetValue = ''; }}
						class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
							{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
					>
						{m === 'handle' ? 'Handle (user@instance)' : 'DID'}
					</button>
				{/each}
			</div>
			{#if userMode === 'did'}
				<Input bind:value={targetValue} placeholder="did:syr:…" class="font-mono" />
				<p class="text-[11px] text-muted-foreground">Exact DID of the target user.</p>
			{:else}
				<Input bind:value={targetValue} placeholder="alice@syr.example.com" class="font-mono" />
				<p class="text-[11px] text-muted-foreground">Resolved to DID at redeem time against the user's syr instance.</p>
			{/if}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Max uses (0 = unlimited)</label>
			<Input type="number" min="0" bind:value={maxUses} />
		</div>
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Expires in</label>
			<select
				bind:value={expiresIn}
				class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
			>
				<option value="0">Never</option>
				<option value="1800">30 minutes</option>
				<option value="3600">1 hour</option>
				<option value="21600">6 hours</option>
				<option value="86400">1 day</option>
				<option value="604800">7 days</option>
			</select>
		</div>
	</div>

	<div class="flex justify-end">
		<Button type="submit" disabled={submitting || (scope !== 'open' && !targetValue.trim())}>
			<Plus class="mr-1.5 h-4 w-4" /> Create invite
		</Button>
	</div>
</form>
