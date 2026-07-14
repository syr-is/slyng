<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { FolderOpen, Shield, Globe, Lock, ImageIcon, Film, FileIcon, User } from '@lucide/svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { adminListUsers, adminListUserFiles } from '@syren/app-core/stores/instance.svelte';
	import type { InstanceUser, OwnedUpload } from '@syren/types';
	import PaginatedTable from '../paginated-table.svelte';

	/**
	 * Instance-admin user browser: a paginated table of local accounts annotated
	 * with per-user storage use + file count, and a read-through into any user's
	 * file library. All calls are admin-guarded server-side.
	 */
	let selected = $state<InstanceUser | null>(null);

	async function loadUsers(params: {
		limit: number;
		offset: number;
		sort?: string;
		order?: 'asc' | 'desc';
		q?: string;
	}): Promise<{ items: InstanceUser[]; total: number }> {
		const page = await adminListUsers({
			q: params.q,
			sort: params.sort,
			order: params.order,
			limit: params.limit,
			offset: params.offset
		});
		return { items: page.items, total: page.total };
	}

	async function loadUserFiles(params: {
		limit: number;
		offset: number;
		sort?: string;
		order?: 'asc' | 'desc';
		q?: string;
	}): Promise<{ items: OwnedUpload[]; total: number }> {
		if (!selected) return { items: [], total: 0 };
		const page = await adminListUserFiles(selected.did, {
			search: params.q,
			sort: params.sort,
			order: params.order,
			limit: params.limit,
			offset: params.offset
		});
		return { items: page.data, total: page.pagination.total };
	}

	const userColumns = [
		{ key: 'username', label: 'User', sortable: true },
		{ key: 'storage', label: 'Storage', class: 'whitespace-nowrap' },
		{ key: 'files', label: 'Files', class: 'whitespace-nowrap' },
		{ key: 'role', label: 'Role', sortable: true, class: 'whitespace-nowrap' },
		{ key: 'created_at', label: 'Joined', sortable: true, class: 'whitespace-nowrap' }
	];

	const fileColumns = [
		{ key: 'filename', label: 'Name', sortable: true },
		{ key: 'size', label: 'Size', sortable: true, class: 'whitespace-nowrap' },
		{ key: 'is_public', label: 'Visibility', class: 'whitespace-nowrap' },
		{ key: 'created_at', label: 'Added', sortable: true, class: 'whitespace-nowrap' }
	];

	function formatBytes(bytes: number): string {
		if (!bytes) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}
	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString();
	}
	function kindIcon(mime: string) {
		if (mime.startsWith('image/')) return ImageIcon;
		if (mime.startsWith('video/')) return Film;
		return FileIcon;
	}
</script>

<div class="space-y-3">
	<div>
		<p class="text-sm font-medium">Users</p>
		<p class="text-xs text-muted-foreground">
			Local accounts on this instance, with storage use. Open a user to browse their files.
		</p>
	</div>

	<PaginatedTable
		columns={userColumns}
		load={loadUsers}
		rowKey={(u: InstanceUser) => u.did || u.username}
		searchPlaceholder="Search by username…"
		initialSort={{ field: 'created_at', order: 'desc' }}
		emptyLabel="No users yet"
	>
		{#snippet cell(row: InstanceUser, key: string)}
			{#if key === 'username'}
				<div class="flex items-center gap-2">
					<div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
						<User class="size-3.5 text-muted-foreground" />
					</div>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{row.username}</p>
						<p class="truncate font-mono text-[10px] text-muted-foreground">{row.did}</p>
					</div>
				</div>
			{:else if key === 'storage'}
				<span class="text-xs">{formatBytes(row.storage_bytes)}</span>
			{:else if key === 'files'}
				<span class="text-xs text-muted-foreground">{row.file_count}</span>
			{:else if key === 'role'}
				{#if row.role === 'ADMIN'}
					<span class="inline-flex items-center gap-1 text-xs font-medium text-primary">
						<Shield class="size-3" /> Admin
					</span>
				{:else}
					<span class="text-xs text-muted-foreground">User</span>
				{/if}
			{:else if key === 'created_at'}
				<span class="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
			{/if}
		{/snippet}

		{#snippet actions(row: InstanceUser)}
			<button
				class="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				title="Browse files"
				onclick={() => (selected = row)}
				disabled={!row.did}
			>
				<FolderOpen class="size-4" />
			</button>
		{/snippet}
	</PaginatedTable>
</div>

<!-- Per-user library browser -->
<Dialog.Root open={!!selected} onOpenChange={(o) => !o && (selected = null)}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<FolderOpen class="size-4" />
				{selected?.username}'s files
			</Dialog.Title>
			<Dialog.Description>
				{selected ? `${formatBytes(selected.storage_bytes)} across ${selected.file_count} file${selected.file_count === 1 ? '' : 's'}` : ''}
			</Dialog.Description>
		</Dialog.Header>
		{#if selected}
			{#key selected.did}
				<PaginatedTable
					columns={fileColumns}
					load={loadUserFiles}
					rowKey={(f: OwnedUpload) => f.local_id}
					searchPlaceholder="Search files…"
					initialSort={{ field: 'created_at', order: 'desc' }}
					pageSize={10}
					emptyLabel="This user has no files"
				>
					{#snippet cell(row: OwnedUpload, key: string)}
						{#if key === 'filename'}
							{@const Icon = kindIcon(row.mime_type)}
							<div class="flex items-center gap-2">
								{#if row.mime_type.startsWith('image/') && row.url}
									<img src={proxied(row.url)} alt="" class="size-8 shrink-0 rounded object-cover" />
								{:else}
									<Icon class="size-5 shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate text-sm">{row.filename}</span>
							</div>
						{:else if key === 'size'}
							<span class="text-xs text-muted-foreground">{formatBytes(row.size)}</span>
						{:else if key === 'is_public'}
							{#if row.is_public}
								<span class="inline-flex items-center gap-1 text-xs text-primary"><Globe class="size-3" /> Public</span>
							{:else}
								<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock class="size-3" /> Private</span>
							{/if}
						{:else if key === 'created_at'}
							<span class="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
						{/if}
					{/snippet}
				</PaginatedTable>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
