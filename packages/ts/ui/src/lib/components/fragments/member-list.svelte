<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Crown } from '@lucide/svelte';
	import { getPresence, getPresenceData, type PresenceStatus } from '@syren/app-core/stores/presence.svelte';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { getMembers, type MemberData } from '@syren/app-core/stores/members.svelte';
	import { getRoles, type RoleData } from '@syren/app-core/stores/roles.svelte';
	import MemberRolesPopover from './member-roles-popover.svelte';
	import ProfileHoverCard from './profile-hover-card.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const STATUS_COLORS: Record<PresenceStatus, string> = {
		online: 'bg-green-500',
		idle: 'bg-yellow-500',
		dnd: 'bg-red-500',
		invisible: 'bg-gray-400',
		offline: 'bg-gray-400'
	};

	const {
		serverId,
		serverOwnerId,
		canManageRoles = false
	}: {
		serverId?: string;
		serverOwnerId?: string | null;
		canManageRoles?: boolean;
	} = $props();

	const memberStore = getMembers();
	const roleStore = getRoles();

	function memberRoles(member: MemberData): RoleData[] {
		const ids = (member.role_ids ?? []).map((r) => String(r));
		return roleStore.list.filter((r) => ids.includes(r.id));
	}

	/** Highest-position non-default role, or null if only @everyone. */
	function topRole(member: MemberData): RoleData | null {
		const rs = memberRoles(member).filter((r) => !r.is_default);
		if (!rs.length) return null;
		return rs.reduce((acc, r) => (r.position > acc.position ? r : acc));
	}

	function nameColor(member: MemberData): string | null {
		// Highest-position *colored* role wins
		const rs = memberRoles(member).sort((a, b) => b.position - a.position);
		return rs.find((r) => r.color)?.color ?? null;
	}

	// Group online members by their highest role. Members with no role fall
	// into an "Online" bucket. Sections ordered by role position desc, with
	// "Online" pinned to the bottom.
	const onlineGroups = $derived.by(() => {
		const online = memberStore.list.filter((m) => getPresence(m.user_id) !== 'offline');

		const buckets = new Map<string, { role: RoleData | null; members: MemberData[] }>();
		for (const m of online) {
			const top = topRole(m);
			const key = top?.id ?? '__online__';
			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = { role: top, members: [] };
				buckets.set(key, bucket);
			}
			bucket.members.push(m);
		}

		return [...buckets.values()].sort((a, b) => {
			if (!a.role && !b.role) return 0;
			if (!a.role) return 1;
			if (!b.role) return -1;
			return b.role.position - a.role.position;
		});
	});

	const offline = $derived(memberStore.list.filter((m) => getPresence(m.user_id) === 'offline'));
	const onlineCount = $derived(memberStore.list.filter((m) => getPresence(m.user_id) !== 'offline').length);
</script>

<div class="hidden w-60 flex-col overflow-y-auto border-l border-border bg-sidebar lg:flex">
	<!-- Online, grouped by highest role -->
	{#each onlineGroups as group (group.role?.id ?? '__online__')}
		<div class="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
			{group.role?.name ?? 'Online'} — {group.members.length}
		</div>
		{#each group.members as member (member.user_id)}
			{@const profile = resolveProfile(member.user_id, member.syr_instance_url)}
			{@const name = displayName(profile, member.user_id)}
			{@const presence = getPresenceData(member.user_id)}
			<ProfileHoverCard did={member.user_id} instanceUrl={member.syr_instance_url} triggerClass="block cursor-pointer">
				<div class="group flex items-center gap-2 px-4 py-1.5 w-full">
					<div class="relative">
						<Avatar.Root class="h-8 w-8">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-xs">
								{name.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar {STATUS_COLORS[presence.status]}"></div>
					</div>
					<div class="min-w-0 flex-1 text-left">
						<span
							class="flex items-center gap-1 truncate text-sm text-sidebar-foreground"
							style={nameColor(member) ? `color: ${nameColor(member)}` : ''}
						>
							<span class="truncate">{(member as any).nickname || name}</span>
							{#if serverOwnerId && member.user_id === serverOwnerId}
								<Crown class="h-3.5 w-3.5 shrink-0 text-amber-500" />
							{/if}
						</span>
						{#if presence.custom_status || presence.custom_emoji}
							<span class="block truncate text-[11px] text-sidebar-foreground/60">
								{presence.custom_emoji ?? ''}
								{presence.custom_status ?? ''}
							</span>
						{/if}
					</div>
					{#if canManageRoles && serverId}
						<div class="opacity-0 group-hover:opacity-100">
							<MemberRolesPopover
								{serverId}
								userId={member.user_id}
								assigned={memberRoles(member)}
								allRoles={roleStore.list}
							/>
						</div>
					{/if}
				</div>
			</ProfileHoverCard>
		{/each}
	{/each}

	{#if onlineCount === 0 && offline.length === 0}
		<p class="px-4 py-8 text-center text-xs text-sidebar-foreground/40">No members</p>
	{/if}

	<!-- Offline -->
	{#if offline.length > 0}
		<div class="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
			Offline — {offline.length}
		</div>
		{#each offline as member (member.user_id)}
			{@const profile = resolveProfile(member.user_id, member.syr_instance_url)}
			{@const name = displayName(profile, member.user_id)}
			<ProfileHoverCard did={member.user_id} instanceUrl={member.syr_instance_url} triggerClass="block cursor-pointer">
				<div class="group flex items-center gap-2 px-4 py-1.5 opacity-50 w-full">
					<Avatar.Root class="h-8 w-8">
						{#if profile.avatar_url}
							<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
						{/if}
						<Avatar.Fallback class="text-xs">
							{name.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
					<span
						class="flex flex-1 items-center gap-1 truncate text-sm text-sidebar-foreground text-left"
						style={nameColor(member) ? `color: ${nameColor(member)}` : ''}
					>
						<span class="truncate">{(member as any).nickname || name}</span>
						{#if serverOwnerId && member.user_id === serverOwnerId}
							<Crown class="h-3.5 w-3.5 shrink-0 text-amber-500" />
						{/if}
					</span>
					{#if canManageRoles && serverId}
						<div class="opacity-0 group-hover:opacity-100">
							<MemberRolesPopover
								{serverId}
								userId={member.user_id}
								assigned={memberRoles(member)}
								allRoles={roleStore.list}
							/>
						</div>
					{/if}
				</div>
			</ProfileHoverCard>
		{/each}
	{/if}
</div>
