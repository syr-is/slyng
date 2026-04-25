<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Ban, UserX } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import PaginatedTable from '../paginated-table.svelte';

	const relations = getRelations();

	let savingDms = $state(false);
	let savingReq = $state(false);

	async function saveDmPolicy(next: 'open' | 'friends_only' | 'closed') {
		if (savingDms || next === relations.allowDms) return;
		savingDms = true;
		try {
			await api.users.updateMe({ allow_dms: next });
			toast.success('DM policy saved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		savingDms = false;
	}

	async function saveFriendPolicy(next: 'open' | 'mutual' | 'closed') {
		if (savingReq || next === relations.allowFriendRequests) return;
		savingReq = true;
		try {
			await api.users.updateMe({ allow_friend_requests: next });
			toast.success('Friend request policy saved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
		savingReq = false;
	}

	// ── Blocklist ──
	let blockRefresh = $state(0);
	function loadBlocked(params: {
		limit: number;
		offset: number;
		q?: string;
	}) {
		return api.relations.listBlocked(params) as Promise<{
			items: Array<{ blocker_id: string; blocked_id: string; created_at: string }>;
			total: number;
		}>;
	}
	async function unblock(did: string) {
		try {
			await api.relations.unblock(did);
			toast.success('Unblocked');
			blockRefresh++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unblock');
		}
	}

	// ── Ignorelist ──
	let ignoreRefresh = $state(0);
	function loadIgnored(params: {
		limit: number;
		offset: number;
		q?: string;
	}) {
		return api.relations.listIgnored(params) as Promise<{
			items: Array<{ user_id: string; ignored_id: string; created_at: string }>;
			total: number;
		}>;
	}
	async function unignore(did: string) {
		try {
			await api.relations.unignore(did);
			toast.success('Unignored');
			ignoreRefresh++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	const blockColumns = [
		{ key: 'user', label: 'User' },
		{ key: 'when', label: 'Blocked', class: 'whitespace-nowrap' }
	];
	const ignoreColumns = [
		{ key: 'user', label: 'User' },
		{ key: 'when', label: 'Ignored', class: 'whitespace-nowrap' }
	];

	function formatAgo(iso: string): string {
		const then = new Date(iso).getTime();
		const delta = Date.now() - then;
		const m = Math.floor(delta / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return `${d}d ago`;
	}
</script>

<div class="space-y-8">
	<!-- Policies -->
	<section class="space-y-3">
		<div>
			<h2 class="text-sm font-semibold">Who can DM me</h2>
			<p class="text-xs text-muted-foreground">
				Controls whether others can send you a direct message.
			</p>
		</div>
		<select
			value={relations.allowDms}
			onchange={(e) => saveDmPolicy((e.currentTarget as HTMLSelectElement).value as any)}
			disabled={savingDms}
			class="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm"
		>
			<option value="open">Anyone</option>
			<option value="friends_only">Friends only</option>
			<option value="closed">No one</option>
		</select>
	</section>

	<section class="space-y-3">
		<div>
			<h2 class="text-sm font-semibold">Who can send friend requests</h2>
			<p class="text-xs text-muted-foreground">
				"Mutual" requires the sender to be in at least one server with you.
			</p>
		</div>
		<select
			value={relations.allowFriendRequests}
			onchange={(e) => saveFriendPolicy((e.currentTarget as HTMLSelectElement).value as any)}
			disabled={savingReq}
			class="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm"
		>
			<option value="open">Anyone</option>
			<option value="mutual">Mutual (shared server)</option>
			<option value="closed">No one</option>
		</select>
	</section>

	<!-- Blocklist -->
	<section class="space-y-3">
		<div>
			<h2 class="flex items-center gap-2 text-sm font-semibold">
				<Ban class="h-4 w-4 text-destructive" />
				Blocklist
			</h2>
			<p class="text-xs text-muted-foreground">
				Blocked users can't DM you. Their messages in shared servers show as placeholders.
			</p>
		</div>
		<PaginatedTable
			columns={blockColumns}
			load={loadBlocked}
			rowKey={(r: { blocked_id: string }) => r.blocked_id}
			refreshSignal={blockRefresh}
			searchPlaceholder="Search blocked DIDs…"
			emptyLabel="No blocked users"
			pageSize={25}
		>
			{#snippet cell(row: { blocked_id: string; created_at: string }, key: string)}
				{#if key === 'user'}
					{@const profile = resolveProfile(row.blocked_id, relations.instanceFor(row.blocked_id))}
					{@const name = displayName(profile, row.blocked_id)}
					<div class="flex items-center gap-2">
						<Avatar.Root class="h-7 w-7 shrink-0">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-[10px]">
								{name.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{name}</p>
							<p class="truncate font-mono text-[11px] text-muted-foreground">
								{federatedHandle(profile, row.blocked_id)}
							</p>
						</div>
					</div>
				{:else if key === 'when'}
					<span class="text-xs text-muted-foreground" title={new Date(row.created_at).toLocaleString()}>
						{formatAgo(row.created_at)}
					</span>
				{/if}
			{/snippet}
			{#snippet actions(row: { blocked_id: string })}
				<button
					type="button"
					onclick={() => unblock(row.blocked_id)}
					class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					Unblock
				</button>
			{/snippet}
		</PaginatedTable>
	</section>

	<!-- Ignorelist -->
	<section class="space-y-3">
		<div>
			<h2 class="flex items-center gap-2 text-sm font-semibold">
				<UserX class="h-4 w-4" />
				Ignorelist
			</h2>
			<p class="text-xs text-muted-foreground">
				Ignored users can still DM you, but their messages don't notify and sit in a separate Ignored tab.
			</p>
		</div>
		<PaginatedTable
			columns={ignoreColumns}
			load={loadIgnored}
			rowKey={(r: { ignored_id: string }) => r.ignored_id}
			refreshSignal={ignoreRefresh}
			searchPlaceholder="Search ignored DIDs…"
			emptyLabel="No ignored users"
			pageSize={25}
		>
			{#snippet cell(row: { ignored_id: string; created_at: string }, key: string)}
				{#if key === 'user'}
					{@const profile = resolveProfile(row.ignored_id, relations.instanceFor(row.ignored_id))}
					{@const name = displayName(profile, row.ignored_id)}
					<div class="flex items-center gap-2">
						<Avatar.Root class="h-7 w-7 shrink-0">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
							{/if}
							<Avatar.Fallback class="text-[10px]">
								{name.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{name}</p>
							<p class="truncate font-mono text-[11px] text-muted-foreground">
								{federatedHandle(profile, row.ignored_id)}
							</p>
						</div>
					</div>
				{:else if key === 'when'}
					<span class="text-xs text-muted-foreground" title={new Date(row.created_at).toLocaleString()}>
						{formatAgo(row.created_at)}
					</span>
				{/if}
			{/snippet}
			{#snippet actions(row: { ignored_id: string })}
				<button
					type="button"
					onclick={() => unignore(row.ignored_id)}
					class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					Unignore
				</button>
			{/snippet}
		</PaginatedTable>
	</section>
</div>
