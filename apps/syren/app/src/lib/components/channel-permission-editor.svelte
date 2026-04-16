<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Check, X, Minus, Plus, Loader2, Shield } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Permissions } from '@syren/types';
	import { api } from '$lib/api';
	import { getRoles } from '$lib/stores/roles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import {
		loadOverrides,
		getOverrides,
		invalidateOverrides,
		type OverrideData
	} from '$lib/stores/overrides.svelte';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { proxied } from '$lib/utils/proxy';

	const {
		open,
		serverId,
		scopeType,
		scopeId,
		scopeName,
		channelType,
		onClose
	}: {
		open: boolean;
		serverId: string;
		scopeType: 'channel' | 'category';
		scopeId: string;
		scopeName: string;
		channelType?: 'text' | 'voice';
		onClose: () => void;
	} = $props();

	const roleStore = getRoles();
	const memberStore = getMembers();
	const perms = getPerms();

	const ALL_FLAGS: Array<{ key: string; label: string; flag: bigint; for: 'both' | 'text' | 'voice' }> = [
		{ key: 'READ_MESSAGES', label: 'View Channel', flag: Permissions.READ_MESSAGES, for: 'both' },
		{ key: 'SEND_MESSAGES', label: 'Send Messages', flag: Permissions.SEND_MESSAGES, for: 'text' },
		{ key: 'MANAGE_MESSAGES', label: 'Manage Messages', flag: Permissions.MANAGE_MESSAGES, for: 'text' },
		{ key: 'MANAGE_CHANNELS', label: 'Manage Channel', flag: Permissions.MANAGE_CHANNELS, for: 'both' },
		{ key: 'EMBED_LINKS', label: 'Embed Links', flag: Permissions.EMBED_LINKS, for: 'text' },
		{ key: 'ATTACH_FILES', label: 'Attach Files', flag: Permissions.ATTACH_FILES, for: 'text' },
		{ key: 'ADD_REACTIONS', label: 'Add Reactions', flag: Permissions.ADD_REACTIONS, for: 'text' },
		{ key: 'CONNECT', label: 'Connect', flag: Permissions.CONNECT, for: 'voice' },
		{ key: 'SPEAK', label: 'Speak', flag: Permissions.SPEAK, for: 'voice' }
	];

	// Categories show all flags (they can contain both types). Channels filter by type.
	const EDITABLE_FLAGS = $derived(
		scopeType === 'category' || !channelType
			? ALL_FLAGS
			: ALL_FLAGS.filter((f) => f.for === 'both' || f.for === channelType)
	);

	type TriState = 'allow' | 'deny' | 'inherit';

	$effect(() => {
		if (open) loadOverrides(serverId, scopeType, scopeId);
	});

	const scopeCache = $derived(getOverrides(scopeType, scopeId));
	const overrides = $derived(scopeCache.overrides);

	// Group overrides by target
	const roleOverrides = $derived(overrides.filter((o) => o.target_type === 'role'));
	const userOverrides = $derived(overrides.filter((o) => o.target_type === 'user'));

	function getTriState(override: OverrideData, flag: bigint): TriState {
		const allow = BigInt(override.allow || '0');
		const deny = BigInt(override.deny || '0');
		if ((allow & flag) === flag) return 'allow';
		if ((deny & flag) === flag) return 'deny';
		return 'inherit';
	}

	function cycleTriState(current: TriState): TriState {
		if (current === 'inherit') return 'allow';
		if (current === 'allow') return 'deny';
		return 'inherit';
	}

	let saving = $state(false);

	async function toggleFlag(override: OverrideData, flag: bigint) {
		const current = getTriState(override, flag);
		const next = cycleTriState(current);
		let allow = BigInt(override.allow || '0');
		let deny = BigInt(override.deny || '0');

		// Clear the bit from both
		allow = allow & ~flag;
		deny = deny & ~flag;

		if (next === 'allow') allow = allow | flag;
		else if (next === 'deny') deny = deny | flag;

		saving = true;
		try {
			await api.overrides.upsert(serverId, {
				scope_type: scopeType,
				scope_id: scopeId,
				target_type: override.target_type,
				target_id: override.target_id,
				allow: allow.toString(),
				deny: deny.toString()
			});
			invalidateOverrides(scopeType, scopeId);
			loadOverrides(serverId, scopeType, scopeId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update');
		}
		saving = false;
	}

	// Add override flow
	let showAdd = $state(false);
	let addType = $state<'role' | 'user'>('role');

	async function addOverride(targetType: 'role' | 'user', targetId: string) {
		saving = true;
		try {
			await api.overrides.upsert(serverId, {
				scope_type: scopeType,
				scope_id: scopeId,
				target_type: targetType,
				target_id: targetId,
				allow: '0',
				deny: '0'
			});
			invalidateOverrides(scopeType, scopeId);
			loadOverrides(serverId, scopeType, scopeId);
			showAdd = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		saving = false;
	}

	async function removeOverride(overrideId: string) {
		saving = true;
		try {
			await api.overrides.delete(serverId, overrideId);
			invalidateOverrides(scopeType, scopeId);
			loadOverrides(serverId, scopeType, scopeId);
			toast.success('Override removed');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		saving = false;
	}

	// Roles/users not yet overridden — for the "add" selector
	const availableRoles = $derived(
		roleStore.list.filter(
			(r) => !roleOverrides.some((o) => o.target_id === r.id) && (r.is_default || perms.canManageRole(r))
		)
	);
	const availableMembers = $derived(
		memberStore.list.filter(
			(m) => !userOverrides.some((o) => o.target_id === m.user_id)
		)
	);

	function roleName(targetId: string): string {
		return roleStore.list.find((r) => r.id === targetId)?.name ?? targetId.slice(0, 12);
	}
	function roleColor(targetId: string): string | null {
		return roleStore.list.find((r) => r.id === targetId)?.color ?? null;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="max-h-[80vh] overflow-hidden sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Shield class="h-5 w-5" />
				Permissions — {scopeName}
			</Dialog.Title>
			<Dialog.Description>
				Manage permission overrides for this {scopeType}. Overrides here take priority over server-level role permissions.
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-[60vh] space-y-4 overflow-y-auto py-2">
			{#if scopeCache.loading}
				<div class="flex items-center gap-2 py-8 justify-center text-muted-foreground">
					<Loader2 class="h-4 w-4 animate-spin" /> Loading…
				</div>
			{:else}
				<!-- Role overrides -->
				{#if roleOverrides.length > 0}
					<section>
						<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role overrides</h3>
						{#each roleOverrides as override (override.id)}
							{@const color = roleColor(override.target_id)}
							<div class="mb-3 rounded-md border border-border bg-card p-3">
								<div class="mb-2 flex items-center justify-between">
									<span class="text-sm font-medium" style={color ? `color: ${color}` : ''}>
										{roleName(override.target_id)}
									</span>
									<Button variant="ghost" size="sm" class="h-6 text-xs text-destructive" onclick={() => removeOverride(override.id)}>
										Remove
									</Button>
								</div>
								<div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1 text-xs">
									<span class="text-muted-foreground">Permission</span>
									<span class="w-7 text-center text-green-500" title="Allow"><Check class="mx-auto h-3 w-3" /></span>
									<span class="w-7 text-center text-destructive" title="Deny"><X class="mx-auto h-3 w-3" /></span>
									<span class="w-7 text-center text-muted-foreground" title="Inherit"><Minus class="mx-auto h-3 w-3" /></span>
									{#each EDITABLE_FLAGS as { label, flag } (label)}
										{@const state = getTriState(override, flag)}
										<span>{label}</span>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'allow' ? 'bg-green-500/20 text-green-500' : 'text-muted-foreground/30 hover:text-green-500/60'}">
											<Check class="h-3 w-3" />
										</button>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'deny' ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground/30 hover:text-destructive/60'}">
											<X class="h-3 w-3" />
										</button>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'inherit' ? 'bg-muted text-muted-foreground' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}">
											<Minus class="h-3 w-3" />
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</section>
				{/if}

				<!-- User overrides -->
				{#if userOverrides.length > 0}
					<section>
						<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">User overrides</h3>
						{#each userOverrides as override (override.id)}
							{@const profile = resolveProfile(override.target_id, undefined)}
							{@const name = displayName(profile, override.target_id)}
							<div class="mb-3 rounded-md border border-border bg-card p-3">
								<div class="mb-2 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<Avatar.Root class="h-6 w-6">
											{#if profile.avatar_url}
												<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
											{/if}
											<Avatar.Fallback class="text-[9px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
										</Avatar.Root>
										<span class="text-sm font-medium">{name}</span>
									</div>
									<Button variant="ghost" size="sm" class="h-6 text-xs text-destructive" onclick={() => removeOverride(override.id)}>
										Remove
									</Button>
								</div>
								<div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1 text-xs">
									<span class="text-muted-foreground">Permission</span>
									<span class="w-7 text-center text-green-500"><Check class="mx-auto h-3 w-3" /></span>
									<span class="w-7 text-center text-destructive"><X class="mx-auto h-3 w-3" /></span>
									<span class="w-7 text-center text-muted-foreground"><Minus class="mx-auto h-3 w-3" /></span>
									{#each EDITABLE_FLAGS as { label, flag } (label)}
										{@const state = getTriState(override, flag)}
										<span>{label}</span>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'allow' ? 'bg-green-500/20 text-green-500' : 'text-muted-foreground/30 hover:text-green-500/60'}">
											<Check class="h-3 w-3" />
										</button>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'deny' ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground/30 hover:text-destructive/60'}">
											<X class="h-3 w-3" />
										</button>
										<button type="button" onclick={() => toggleFlag(override, flag)} disabled={saving}
											class="flex h-6 w-7 items-center justify-center rounded transition-colors {state === 'inherit' ? 'bg-muted text-muted-foreground' : 'text-muted-foreground/30 hover:text-muted-foreground/60'}">
											<Minus class="h-3 w-3" />
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</section>
				{/if}

				{#if roleOverrides.length === 0 && userOverrides.length === 0}
					<p class="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
						No permission overrides for this {scopeType}. All permissions are inherited from server roles.
					</p>
				{/if}

				<!-- Add override -->
				{#if !showAdd}
					<Button variant="outline" size="sm" onclick={() => (showAdd = true)}>
						<Plus class="mr-1.5 h-3 w-3" />
						Add override
					</Button>
				{:else}
					<div class="rounded-md border border-border bg-card p-3 space-y-2">
						<div class="flex gap-1">
							{#each [['role', 'Role'], ['user', 'User']] as [k, label] (k)}
								<button
									type="button"
									onclick={() => (addType = k as 'role' | 'user')}
									class="flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors
										{addType === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
								>{label}</button>
							{/each}
						</div>
						{#if addType === 'role'}
							{#if availableRoles.length === 0}
								<p class="text-xs text-muted-foreground">All manageable roles already have overrides.</p>
							{:else}
								<div class="max-h-40 overflow-y-auto space-y-0.5">
									{#each availableRoles as r (r.id)}
										<button
											type="button"
											onclick={() => addOverride('role', r.id)}
											disabled={saving}
											class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										>
											<span class="h-2 w-2 rounded-full" style="background-color: {r.color || '#99aab5'}"></span>
											{r.name}
										</button>
									{/each}
								</div>
							{/if}
						{:else}
							{#if availableMembers.length === 0}
								<p class="text-xs text-muted-foreground">All members already have overrides.</p>
							{:else}
								<div class="max-h-40 overflow-y-auto space-y-0.5">
									{#each availableMembers as m (m.user_id)}
										{@const profile = resolveProfile(m.user_id, m.syr_instance_url)}
										{@const name = displayName(profile, m.user_id)}
										<button
											type="button"
											onclick={() => addOverride('user', m.user_id)}
											disabled={saving}
											class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										>
											<Avatar.Root class="h-5 w-5">
												{#if profile.avatar_url}
													<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
												{/if}
												<Avatar.Fallback class="text-[8px]">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
											</Avatar.Root>
											{name}
										</button>
									{/each}
								</div>
							{/if}
						{/if}
						<Button variant="ghost" size="sm" onclick={() => (showAdd = false)}>Cancel</Button>
					</div>
				{/if}
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
