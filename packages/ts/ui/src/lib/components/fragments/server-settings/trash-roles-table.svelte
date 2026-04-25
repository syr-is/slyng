<script lang="ts">
	import { Shield, RotateCcw, Trash2, Loader2 } from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { toast } from 'svelte-sonner';
	import { api } from '@syren/app-core/api';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import HardDeleteConfirmDialog from './hard-delete-confirm-dialog.svelte';

	interface TrashedRole {
		id: string;
		name: string;
		color: string | null;
		deleted_at: string;
		deleted_by: string;
		member_count: number;
	}

	const { serverId }: { serverId: string } = $props();

	const perms = getPerms();
	let rows = $state<TrashedRole[]>([]);
	let loading = $state(true);
	let pendingHard = $state<TrashedRole | null>(null);

	async function refresh() {
		loading = true;
		try {
			rows = await api.servers.trashRoles(serverId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load trashed roles');
		}
		loading = false;
	}

	$effect(() => {
		if (serverId) refresh();
	});

	async function restore(row: TrashedRole) {
		try {
			await api.roles.restore(row.id);
			toast.success(`Restored "${row.name}"`);
			rows = rows.filter((r) => r.id !== row.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to restore');
		}
	}

	async function hardDelete(row: TrashedRole) {
		try {
			await api.roles.hardDelete(row.id);
			toast.success(`Deleted "${row.name}" forever`);
			rows = rows.filter((r) => r.id !== row.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete forever');
			throw err;
		}
	}

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

{#if loading}
	<div class="flex items-center justify-center py-10 text-muted-foreground">
		<Loader2 class="h-5 w-5 animate-spin" />
	</div>
{:else if rows.length === 0}
	<p class="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
		Trash is empty. Deleted roles show up here so you can restore them. Members keep their role assignments while trashed, but the role's permissions don't apply.
	</p>
{:else}
	<div class="overflow-hidden rounded-md border border-border">
		<table class="w-full text-sm">
			<thead class="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
				<tr>
					<th class="px-3 py-2 text-left font-medium">Role</th>
					<th class="px-3 py-2 text-left font-medium">Members</th>
					<th class="px-3 py-2 text-left font-medium">Deleted by</th>
					<th class="px-3 py-2 text-left font-medium">When</th>
					<th class="px-3 py-2 text-right font-medium">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					{@const profile = resolveProfile(row.deleted_by, undefined)}
					<tr class="border-t border-border">
						<td class="px-3 py-2">
							<div class="flex items-center gap-2">
								<span
									class="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
									style:background-color={row.color ?? 'transparent'}
								></span>
								<Shield class="h-4 w-4 shrink-0 text-muted-foreground" />
								<span class="truncate font-medium">{row.name}</span>
							</div>
						</td>
						<td class="px-3 py-2 text-muted-foreground">{row.member_count}</td>
						<td class="px-3 py-2">
							<div class="flex items-center gap-2">
								<Avatar.Root class="h-6 w-6 shrink-0">
									{#if profile.avatar_url}
										<Avatar.Image src={proxied(profile.avatar_url)} alt={displayName(profile, row.deleted_by)} />
									{/if}
									<Avatar.Fallback class="text-[9px]">
										{displayName(profile, row.deleted_by).slice(0, 2).toUpperCase()}
									</Avatar.Fallback>
								</Avatar.Root>
								<span class="truncate text-xs">{displayName(profile, row.deleted_by)}</span>
							</div>
						</td>
						<td class="px-3 py-2 text-xs text-muted-foreground" title={new Date(row.deleted_at).toLocaleString()}>
							{formatAgo(row.deleted_at)}
						</td>
						<td class="px-3 py-2">
							<div class="flex items-center justify-end gap-1">
								<button
									type="button"
									onclick={() => restore(row)}
									title={row.member_count > 0 ? `Restore role (${row.member_count} member${row.member_count === 1 ? '' : 's'} get permissions back)` : 'Restore role'}
									class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<RotateCcw class="h-4 w-4" />
								</button>
								{#if perms.canHardDelete}
									<button
										type="button"
										onclick={() => (pendingHard = row)}
										title="Delete forever"
										class="rounded p-1.5 text-destructive hover:bg-destructive/10"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if pendingHard}
	<HardDeleteConfirmDialog
		open={true}
		kind="role"
		name={pendingHard.name}
		count={pendingHard.member_count}
		onConfirm={async () => {
			const r = pendingHard;
			if (r) await hardDelete(r);
		}}
		onClose={() => (pendingHard = null)}
	/>
{/if}
