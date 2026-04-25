<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { AlertTriangle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';
	import { getMembers } from '@syren/app-core/stores/members.svelte';
	import { getServerState } from '@syren/app-core/stores/servers.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const {
		open,
		serverId,
		serverName,
		onClose
	}: {
		open: boolean;
		serverId: string;
		serverName: string;
		onClose: () => void;
	} = $props();

	const memberStore = getMembers();
	const serverState = getServerState();

	// Eligible recipients = every current member except the owner themselves.
	const eligible = $derived(
		memberStore.list.filter((m) => m.user_id !== serverState.activeServerOwnerId)
	);

	let selectedMemberId = $state('');
	let typedName = $state('');
	let confirmed = $state(false);
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			selectedMemberId = '';
			typedName = '';
			confirmed = false;
			submitting = false;
		}
	});

	const nameMatches = $derived(typedName.trim() === serverName.trim() && typedName.trim().length > 0);
	const canSubmit = $derived(!!selectedMemberId && nameMatches && confirmed && !submitting);

	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		try {
			await api.servers.transferOwnership(serverId, selectedMemberId);
			toast.success('Ownership transferred');
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to transfer ownership');
		}
		submitting = false;
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v && !submitting) onClose(); }}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<AlertTriangle class="h-5 w-5" />
				Transfer ownership of {serverName}?
			</Dialog.Title>
			<Dialog.Description>
				The server will immediately belong to the selected member. You'll keep a new
				<span class="font-medium text-foreground">Former Owner</span> role with admin
				permissions at the top of the hierarchy — bounded by the strict-below rule,
				so you still can't manage the new owner.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-3">
			<div class="space-y-1.5">
				<label for="new-owner" class="text-xs font-medium text-muted-foreground">
					New owner
				</label>
				{#if eligible.length === 0}
					<p class="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
						No other members in this server to transfer to.
					</p>
				{:else}
					<select
						id="new-owner"
						bind:value={selectedMemberId}
						class="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
					>
						<option value="">Select a member…</option>
						{#each eligible as m (m.user_id)}
							{@const profile = resolveProfile(m.user_id, m.syr_instance_url)}
							<option value={m.user_id}>
								{displayName(profile, m.user_id)} ({federatedHandle(profile, m.user_id)})
							</option>
						{/each}
					</select>
					{#if selectedMemberId}
						{@const picked = eligible.find((m) => m.user_id === selectedMemberId)}
						{#if picked}
							{@const profile = resolveProfile(picked.user_id, picked.syr_instance_url)}
							<div class="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
								<Avatar.Root class="h-6 w-6">
									{#if profile.avatar_url}
										<Avatar.Image src={proxied(profile.avatar_url)} alt="" />
									{/if}
									<Avatar.Fallback class="text-[10px]">
										{displayName(profile, picked.user_id).slice(0, 2).toUpperCase()}
									</Avatar.Fallback>
								</Avatar.Root>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{displayName(profile, picked.user_id)}</p>
									<p class="truncate font-mono text-[10px] text-muted-foreground">{picked.user_id}</p>
								</div>
							</div>
						{/if}
					{/if}
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="confirm-name" class="text-xs font-medium text-muted-foreground">
					Type <span class="font-mono text-foreground">{serverName}</span> to confirm
				</label>
				<Input id="confirm-name" bind:value={typedName} placeholder={serverName} autocomplete="off" />
			</div>

			<label class="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/20 p-3">
				<input
					type="checkbox"
					bind:checked={confirmed}
					class="mt-0.5 h-4 w-4 rounded border-input"
				/>
				<span class="text-xs text-foreground">
					I understand I'm giving up ownership of this server. The new owner can strip or
					remove my Former Owner role at any time.
				</span>
			</label>
		</div>

		<Dialog.Footer>
			<Button variant="outline" disabled={submitting} onclick={onClose}>Cancel</Button>
			<Button variant="destructive" disabled={!canSubmit} onclick={submit}>
				{submitting ? 'Transferring…' : 'Transfer ownership'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
