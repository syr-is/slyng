<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Loader2, ShieldOff } from '@lucide/svelte';
	import * as Tooltip from '@syren/ui/tooltip';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { idpJson } from '@syren/app-core/idp-fetch';
	import type { PlatformDelegationInfo } from '@syren/types';

	/**
	 * Platform connections: every delegation issued for the user's DID —
	 * which platforms hold a signing key delegated from their identity.
	 * Reads the same public endpoint remote verifiers use
	 * (/api/platform/delegations) and revokes through the authed
	 * /api/platform/revoke.
	 */

	const auth = getAuth();

	let delegations = $state<PlatformDelegationInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let revoking = $state<string | null>(null);

	const ownInstance = $derived(auth.identity?.syr_instance_url ?? '');

	function isLoginDelegation(d: PlatformDelegationInfo): boolean {
		try {
			return new URL(d.platform_origin).origin === new URL(ownInstance).origin;
		} catch {
			return false;
		}
	}

	function status(d: PlatformDelegationInfo): 'active' | 'revoked' | 'expired' {
		if (d.revoked_at) return 'revoked';
		if (d.expires_at && new Date(d.expires_at) < new Date()) return 'expired';
		return 'active';
	}

	async function load() {
		const did = auth.identity?.did;
		if (!did) {
			loading = false;
			return;
		}
		try {
			delegations = await idpJson<PlatformDelegationInfo[]>(
				`/platform/delegations?did=${encodeURIComponent(did)}`
			);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load connections';
		} finally {
			loading = false;
		}
	}

	async function revoke(d: PlatformDelegationInfo) {
		revoking = d.delegate_public_key;
		try {
			await idpJson('/platform/revoke', {
				method: 'POST',
				body: JSON.stringify({ platform_origin: d.platform_origin })
			});
			toast.success(`Revoked ${d.platform_name}`);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Revoke failed');
		} finally {
			revoking = null;
		}
	}

	onMount(load);
</script>

{#if loading}
	<div class="flex justify-center p-8">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
		{error}
	</p>
{:else if delegations.length === 0}
	<p class="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
		No platforms are connected to your identity yet. When you sign in to a platform with this
		identity, it appears here.
	</p>
{:else}
	<div class="space-y-2">
		{#each delegations as d (d.delegate_public_key)}
			{@const s = status(d)}
			{@const isLogin = isLoginDelegation(d)}
			<div
				class="flex items-center gap-3 rounded-lg border border-border bg-card p-3 {s !== 'active'
					? 'opacity-60'
					: ''}"
			>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<p class="truncate text-sm font-medium text-foreground">{d.platform_name}</p>
						{#if isLogin}
							<span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
								this instance
							</span>
						{/if}
						{#if s !== 'active'}
							<span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								{s}
							</span>
						{/if}
					</div>
					<p class="truncate font-mono text-xs text-muted-foreground">{d.platform_origin}</p>
					<p class="text-xs text-muted-foreground">
						Since {new Date(d.created_at).toLocaleDateString()}
					</p>
				</div>
				{#if s === 'active'}
					{#if isLogin}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Button variant="ghost" size="sm" disabled>
									<ShieldOff class="mr-1.5 size-4" /> Revoke
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>Used by your login sessions on this instance</Tooltip.Content>
						</Tooltip.Root>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => revoke(d)}
							disabled={revoking === d.delegate_public_key}
						>
							{#if revoking === d.delegate_public_key}
								<Loader2 class="mr-1.5 size-4 animate-spin" />
							{:else}
								<ShieldOff class="mr-1.5 size-4" />
							{/if}
							Revoke
						</Button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}
