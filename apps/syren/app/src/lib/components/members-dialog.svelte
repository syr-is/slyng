<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Crown, UserMinus, Search } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { getMembers, type MemberData } from '$lib/stores/members.svelte';
	import { getRoles, type RoleData } from '$lib/stores/roles.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { getServerState } from '$lib/stores/servers.svelte';
	import MemberRolesPopover from './member-roles-popover.svelte';

	const {
		open,
		serverId,
		onClose
	}: {
		open: boolean;
		serverId: string;
		onClose: () => void;
	} = $props();

	const memberStore = getMembers();
	const roleStore = getRoles();
	const perms = getPerms();
	const serverState = getServerState();
	const serverOwnerId = $derived(serverState.activeServerOwnerId);

	let search = $state('');

	function memberRoles(member: MemberData): RoleData[] {
		const ids = (member.role_ids ?? []).map((r) => String(r));
		return roleStore.list.filter((r) => ids.includes(r.id));
	}

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return memberStore.list;
		return memberStore.list.filter((m) => {
			const profile = resolveProfile(m.user_id, m.syr_instance_url);
			const name = displayName(profile, m.user_id).toLowerCase();
			const handle = federatedHandle(profile, m.user_id).toLowerCase();
			return name.includes(q) || handle.includes(q) || m.user_id.toLowerCase().includes(q);
		});
	});

	async function kick(member: MemberData) {
		try {
			await api.servers.kickMember(serverId, member.user_id);
			toast.success('Member kicked');
			// WS MEMBER_REMOVE handler updates store
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to kick');
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Members — {memberStore.list.length}</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-3 py-4">
			<div class="relative">
				<Search class="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={search} placeholder="Search members..." class="pl-8" />
			</div>

			<div class="max-h-96 space-y-1 overflow-y-auto">
				{#each filtered as member (member.user_id)}
					{@const profile = resolveProfile(member.user_id, member.syr_instance_url)}
					{@const name = displayName(profile, member.user_id)}
					{@const handle = federatedHandle(profile, member.user_id)}
					{@const isOwner = serverOwnerId && member.user_id === serverOwnerId}
					{@const rs = memberRoles(member)}
					<div class="flex items-center gap-3 rounded-md border border-border px-3 py-2">
						<Avatar.Root class="h-9 w-9 shrink-0">
							{#if profile.avatar_url}
								<Avatar.Image src={profile.avatar_url} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">
								{name.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1">
								<span class="truncate text-sm font-medium text-foreground">{name}</span>
								{#if isOwner}
									<Crown class="h-3.5 w-3.5 shrink-0 text-amber-500" />
								{/if}
							</div>
							<p class="truncate font-mono text-xs text-muted-foreground">{handle}</p>
							{#if rs.length > 0}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each rs as r}
										<span
											class="rounded px-1.5 py-0.5 text-[10px]"
											style="background-color: {(r.color || '#99aab5')}33; color: {r.color || '#99aab5'}"
										>{r.name}</span>
									{/each}
								</div>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1">
							{#if perms.canManageRoles}
								<MemberRolesPopover
									{serverId}
									userId={member.user_id}
									assigned={rs}
									allRoles={roleStore.list}
								/>
							{/if}
							{#if perms.canKick && !isOwner}
								<button
									onclick={() => kick(member)}
									class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
									title="Kick member"
								>
									<UserMinus class="h-4 w-4" />
								</button>
							{/if}
						</div>
					</div>
				{/each}

				{#if filtered.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground">No members match.</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
