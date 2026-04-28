<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { CreateInviteInputSchema } from '@syren/types';
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

	let userMode = $state<UserMode>('handle');
	let maxUsesText = $state('0');
	let expiresInText = $state('0');

	const scopeLabels: Record<Scope, string> = {
		open: 'Anyone',
		instance: 'Instance',
		did: 'Single user'
	};

	// Schema covers everything that ships in the body. Built on top of
	// `CreateInviteInputSchema` (generated from
	// `packages/rust/syren-types/src/server.rs::CreateInviteInput`),
	// then refined for the conditional `target_kind` ↔ `target_value`
	// rules — those aren't expressible at the Rust struct level.
	const Schema = CreateInviteInputSchema.extend({
		max_uses: z.number().int().min(0).default(0),
		expires_in: z.number().int().min(0).default(0),
		target_kind: z.enum(['open', 'instance', 'did']).default('open'),
		target_value: z.string().optional(),
		label: z.string().max(64).optional()
	}).superRefine((data, ctx) => {
		if (data.target_kind === 'open') return;
		const v = data.target_value?.trim();
		if (!v) {
			ctx.addIssue({
				code: 'custom',
				path: ['target_value'],
				message: 'Required for this scope'
			});
			return;
		}
		if (data.target_kind === 'did') {
			if (userMode === 'did' && !v.startsWith('did:')) {
				ctx.addIssue({
					code: 'custom',
					path: ['target_value'],
					message: 'Expected a DID starting with `did:`'
				});
			} else if (userMode === 'handle') {
				const at = v.indexOf('@');
				if (at <= 0 || at === v.length - 1) {
					ctx.addIssue({
						code: 'custom',
						path: ['target_value'],
						message: 'Expected `handle@instance.host`'
					});
				}
			}
		}
	});

	const form = superForm(
		defaults(
			{
				max_uses: 0,
				expires_in: 0,
				target_kind: 'open' as const
			},
			zod4(Schema)
		),
		{
			SPA: true,
			validators: zod4Client(Schema),
			onUpdate: async ({ form: f }) => {
				if (!f.valid) return;
				try {
					await api.servers.createInvite(serverId, {
						max_uses: f.data.max_uses,
						expires_in: f.data.expires_in > 0 ? f.data.expires_in : undefined,
						target_kind: f.data.target_kind,
						target_value:
							f.data.target_kind === 'open' ? undefined : f.data.target_value?.trim() || undefined,
						label: f.data.label?.trim() || undefined
					});
					toast.success('Invite created');
					f.data.label = '';
					f.data.target_value = '';
					maxUsesText = '0';
					expiresInText = '0';
					onCreated();
				} catch (err) {
					toast.error(err instanceof Error ? err.message : 'Failed to create invite');
				}
			}
		}
	);
	const { form: formData, enhance, submitting } = form;

	function setScope(s: Scope) {
		$formData.target_kind = s;
		$formData.target_value = '';
	}

	function switchUserMode(m: UserMode) {
		userMode = m;
		$formData.target_value = '';
	}

	// Mirror the integer text fields back into form state.
	$effect(() => {
		const n = parseInt(maxUsesText, 10);
		$formData.max_uses = Number.isFinite(n) && n >= 0 ? n : 0;
	});
	$effect(() => {
		const n = parseInt(expiresInText, 10);
		$formData.expires_in = Number.isFinite(n) && n >= 0 ? n : 0;
	});
</script>

<form method="POST" use:enhance class="space-y-3 rounded-lg border border-border bg-card p-4">
	<p class="text-sm font-medium">Create a new invite</p>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<Form.Field {form} name="label">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs text-muted-foreground">Label (optional)</Form.Label>
					<Input {...props} bind:value={$formData.label} placeholder="e.g. 'for alice'" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Scope</label>
			<div class="flex gap-1">
				{#each ['open', 'instance', 'did'] as k (k)}
					{@const active = $formData.target_kind === k}
					<button
						type="button"
						onclick={() => setScope(k as Scope)}
						class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
							{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
					>
						{scopeLabels[k as Scope]}
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if $formData.target_kind === 'instance'}
		<Form.Field {form} name="target_value">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs text-muted-foreground">Instance host</Form.Label>
					<Input {...props} bind:value={$formData.target_value} placeholder="syr.example.com" />
				{/snippet}
			</Form.Control>
			<Form.Description class="text-[11px]">
				Only users whose syr instance hostname matches this can join.
			</Form.Description>
			<Form.FieldErrors />
		</Form.Field>
	{:else if $formData.target_kind === 'did'}
		<Form.Field {form} name="target_value">
			<div class="space-y-2">
				<div class="flex gap-1">
					{#each ['handle', 'did'] as m (m)}
						{@const active = userMode === m}
						<button
							type="button"
							onclick={() => switchUserMode(m as UserMode)}
							class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
								{active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
						>
							{m === 'handle' ? 'Handle (user@instance)' : 'DID'}
						</button>
					{/each}
				</div>
				<Form.Control>
					{#snippet children({ props })}
						{#if userMode === 'did'}
							<Input
								{...props}
								bind:value={$formData.target_value}
								placeholder="did:syr:…"
								class="font-mono"
							/>
						{:else}
							<Input
								{...props}
								bind:value={$formData.target_value}
								placeholder="alice@syr.example.com"
								class="font-mono"
							/>
						{/if}
					{/snippet}
				</Form.Control>
				<Form.Description class="text-[11px]">
					{#if userMode === 'did'}
						Exact DID of the target user.
					{:else}
						Resolved to DID at redeem time against the user's syr instance.
					{/if}
				</Form.Description>
				<Form.FieldErrors />
			</div>
		</Form.Field>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Max uses (0 = unlimited)</label>
			<Input type="number" min="0" bind:value={maxUsesText} />
		</div>
		<div class="space-y-1">
			<label class="text-xs text-muted-foreground">Expires in</label>
			<select
				bind:value={expiresInText}
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
		<Form.Button disabled={$submitting}>
			<Plus class="mr-1.5 h-4 w-4" /> Create invite
		</Form.Button>
	</div>
</form>
