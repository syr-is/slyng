<script lang="ts">
	// Personal file library (P7) — folders, uploads, storage quota + share links,
	// all hosted on this slyng instance. Owner-only management surface; the
	// federation read is GET /api/public/uploads/:did. Files upload into whatever
	// folder is currently open (presign → PUT → complete).
	import {
		Folder,
		FolderPlus,
		Upload,
		FileIcon,
		ImageIcon,
		Film,
		Share2,
		Trash2,
		Pencil,
		Globe,
		Lock,
		ChevronRight,
		Loader2,
		Copy,
		Check,
		HardDrive
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import * as Dialog from '@slyng/ui/dialog';
	import { proxied, formatBytes } from '@slyng/app-core/utils/proxy';
	import {
		getStorageUsage,
		listFolders,
		createFolder,
		deleteFolder,
		listFiles,
		uploadLibraryFile,
		patchFile,
		deleteFile,
		shareFile,
		type OwnedFolder,
		type OwnedUpload,
		type StorageUsage
	} from '@slyng/app-core/upload/library';
	import { getInstance, loadInstanceLimits } from '@slyng/app-core/stores/instance.svelte';
	import PaginatedTable from '../fragments/paginated-table.svelte';

	const instance = getInstance();
	const maxFileBytes = $derived(instance.limits?.max_file_size_bytes ?? Infinity);
	const maxFileLabel = $derived(
		instance.limits ? `${instance.limits.max_file_size_mb} MB` : null
	);

	// ── Navigation state ────────────────────────────────────────────────
	let currentFolderId = $state<string | null>(null); // null = root
	let breadcrumbs = $state<{ id: string; name: string }[]>([]);
	let folders = $state<OwnedFolder[]>([]);
	let foldersLoading = $state(true);
	let usage = $state<StorageUsage | null>(null);
	let refreshSignal = $state(0);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function loadUsage() {
		try {
			usage = await getStorageUsage();
		} catch {
			usage = null;
		}
	}

	async function loadFolders() {
		foldersLoading = true;
		try {
			const res = await listFolders(currentFolderId);
			folders = res.folders;
			breadcrumbs = res.breadcrumbs;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load folders');
			folders = [];
			breadcrumbs = [];
		} finally {
			foldersLoading = false;
		}
	}

	// Re-list folders whenever the current folder changes.
	$effect(() => {
		void currentFolderId;
		void loadFolders();
	});

	$effect(() => {
		void loadUsage();
		void loadInstanceLimits();
	});

	function openFolder(id: string | null) {
		currentFolderId = id;
		refreshSignal++; // reload the file table for the new folder
	}

	// ── File table ──────────────────────────────────────────────────────
	async function load(params: {
		limit: number;
		offset: number;
		sort?: string;
		order?: 'asc' | 'desc';
		q?: string;
	}): Promise<{ items: OwnedUpload[]; total: number }> {
		const page = await listFiles({
			folderId: currentFolderId,
			search: params.q,
			sort: (params.sort as 'created_at' | 'filename' | 'size' | 'updated_at') || 'created_at',
			order: params.order ?? 'desc',
			limit: params.limit,
			offset: params.offset
		});
		return { items: page.data, total: page.pagination.total };
	}

	const columns = [
		{ key: 'filename', label: 'Name', sortable: true },
		{ key: 'size', label: 'Size', sortable: true, class: 'whitespace-nowrap' },
		{ key: 'is_public', label: 'Visibility', class: 'whitespace-nowrap' },
		{ key: 'created_at', label: 'Added', sortable: true, class: 'whitespace-nowrap' }
	];

	// ── Upload ──────────────────────────────────────────────────────────
	async function onFilesPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length) return;
		uploading = true;
		let ok = 0;
		for (const file of files) {
			// Client-side guard against the instance per-file cap (server enforces too).
			if (file.size > maxFileBytes) {
				toast.error(`${file.name}: exceeds the ${maxFileLabel} per-file limit`);
				continue;
			}
			try {
				await uploadLibraryFile(file, { folderId: currentFolderId });
				ok++;
			} catch (err) {
				toast.error(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
			}
		}
		uploading = false;
		if (ok > 0) {
			toast.success(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`);
			refreshSignal++;
			void loadUsage();
		}
	}

	// ── New folder dialog ───────────────────────────────────────────────
	let showNewFolder = $state(false);
	let newFolderName = $state('');
	let newFolderPublic = $state(false);
	let creatingFolder = $state(false);

	async function submitNewFolder() {
		const name = newFolderName.trim();
		if (!name) return;
		creatingFolder = true;
		try {
			await createFolder({ name, parent_id: currentFolderId, is_public: newFolderPublic });
			toast.success(`Folder "${name}" created`);
			showNewFolder = false;
			newFolderName = '';
			newFolderPublic = false;
			await loadFolders();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create folder');
		} finally {
			creatingFolder = false;
		}
	}

	// ── Delete folder dialog ────────────────────────────────────────────
	let folderToDelete = $state<OwnedFolder | null>(null);
	let deletingFolder = $state(false);

	async function confirmDeleteFolder() {
		if (!folderToDelete) return;
		deletingFolder = true;
		try {
			await deleteFolder(folderToDelete.id, true);
			toast.success('Folder deleted');
			folderToDelete = null;
			await loadFolders();
			refreshSignal++;
			void loadUsage();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete folder');
		} finally {
			deletingFolder = false;
		}
	}

	// ── File: rename / delete / share / visibility ──────────────────────
	let fileToRename = $state<OwnedUpload | null>(null);
	let renameValue = $state('');
	let renaming = $state(false);

	function openRename(f: OwnedUpload) {
		fileToRename = f;
		renameValue = f.filename;
	}
	async function submitRename() {
		if (!fileToRename) return;
		const filename = renameValue.trim();
		if (!filename) return;
		renaming = true;
		try {
			await patchFile(fileToRename.did, fileToRename.local_id, { filename });
			toast.success('Renamed');
			fileToRename = null;
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Rename failed');
		} finally {
			renaming = false;
		}
	}

	let fileToDelete = $state<OwnedUpload | null>(null);
	let deletingFile = $state(false);
	async function confirmDeleteFile() {
		if (!fileToDelete) return;
		deletingFile = true;
		try {
			await deleteFile(fileToDelete.did, fileToDelete.local_id);
			toast.success('File deleted');
			fileToDelete = null;
			refreshSignal++;
			void loadUsage();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
		} finally {
			deletingFile = false;
		}
	}

	async function toggleVisibility(f: OwnedUpload) {
		try {
			await patchFile(f.did, f.local_id, { is_public: !f.is_public });
			toast.success(f.is_public ? 'Made private' : 'Made public');
			refreshSignal++;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to change visibility');
		}
	}

	// Share dialog
	let shareTarget = $state<OwnedUpload | null>(null);
	let shareUrl = $state('');
	let shareExpiry = $state<string | null>(null);
	let sharePublic = $state(false);
	let sharing = $state(false);
	let copied = $state(false);

	async function openShare(f: OwnedUpload) {
		shareTarget = f;
		shareUrl = '';
		shareExpiry = null;
		copied = false;
		sharing = true;
		try {
			const res = await shareFile(f.did, f.local_id, 86400); // 24h default
			shareUrl = res.url;
			shareExpiry = res.expiresAt;
			sharePublic = res.isPublic;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create link');
			shareTarget = null;
		} finally {
			sharing = false;
		}
	}
	async function copyShare() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			toast.error('Could not copy to clipboard');
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────
	function formatAgo(iso: string): string {
		const delta = Date.now() - new Date(iso).getTime();
		const m = Math.floor(delta / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}
	function kindIcon(mime: string) {
		if (mime.startsWith('image/')) return ImageIcon;
		if (mime.startsWith('video/')) return Film;
		return FileIcon;
	}
</script>

<div class="flex h-full flex-col">
	<!-- Top bar (label only — the sidebar handles navigation) -->
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
		<HardDrive class="h-4 w-4 text-muted-foreground" />
		<span class="text-sm font-semibold">Files</span>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-4xl space-y-4 p-4">
			<!-- Storage usage -->
			{#if usage}
				<div class="rounded-lg border border-border bg-muted/30 p-3">
					<div class="mb-1.5 flex items-center justify-between text-xs">
						<span class="font-medium">Storage</span>
						<span class="text-muted-foreground">
							{formatBytes(usage.bytes_used)} / {formatBytes(usage.bytes_limit)}
						</span>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full {usage.percentage_used > 90
								? 'bg-destructive'
								: 'bg-primary'} transition-[width]"
							style="width: {Math.min(100, usage.percentage_used)}%"
						></div>
					</div>
				</div>
			{/if}

			<!-- Actions + breadcrumbs -->
			<div class="flex flex-wrap items-center justify-between gap-2">
				<nav class="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
					<button
						class="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground {currentFolderId ===
						null
							? 'font-medium text-foreground'
							: ''}"
						onclick={() => openFolder(null)}>Files</button
					>
					{#each breadcrumbs as crumb, i (crumb.id)}
						<ChevronRight class="size-3.5 shrink-0" />
						<button
							class="truncate rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground {i ===
							breadcrumbs.length - 1
								? 'font-medium text-foreground'
								: ''}"
							onclick={() => openFolder(crumb.id)}>{crumb.name}</button
						>
					{/each}
				</nav>

				<div class="flex shrink-0 items-center gap-2">
					<Button variant="outline" size="sm" class="gap-1.5" onclick={() => (showNewFolder = true)}>
						<FolderPlus class="size-4" /> New folder
					</Button>
					<input
						bind:this={fileInput}
						type="file"
						multiple
						class="hidden"
						onchange={onFilesPicked}
					/>
					<Button size="sm" class="gap-1.5" disabled={uploading} onclick={() => fileInput?.click()}>
						{#if uploading}<Loader2 class="size-4 animate-spin" />{:else}<Upload class="size-4" />{/if}
						Upload
					</Button>
				</div>
			</div>
			{#if maxFileLabel}
				<p class="text-right text-[11px] text-muted-foreground">Max {maxFileLabel} per file</p>
			{/if}

			<!-- Folders at this level -->
			{#if foldersLoading}
				<div class="flex justify-center py-4"><Loader2 class="size-4 animate-spin text-muted-foreground" /></div>
			{:else if folders.length}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
					{#each folders as folder (folder.id)}
						<div
							class="group flex items-center gap-2 rounded-md border border-border bg-card p-2.5 transition-colors hover:border-primary/40"
						>
							<button
								class="flex min-w-0 flex-1 items-center gap-2 text-left"
								onclick={() => openFolder(folder.id)}
							>
								<Folder class="size-4 shrink-0 text-primary" />
								<span class="truncate text-sm font-medium">{folder.name}</span>
								{#if folder.is_public}<Globe class="size-3 shrink-0 text-muted-foreground" />{/if}
							</button>
							<button
								class="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
								title="Delete folder"
								onclick={() => (folderToDelete = folder)}
							>
								<Trash2 class="size-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Files -->
			<PaginatedTable
				{columns}
				{load}
				{refreshSignal}
				rowKey={(f: OwnedUpload) => f.local_id}
				searchPlaceholder="Search files…"
				initialSort={{ field: 'created_at', order: 'desc' }}
				emptyLabel="No files here yet"
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
							<span class="truncate text-sm font-medium">{row.filename}</span>
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
						<span class="text-xs text-muted-foreground" title={new Date(row.created_at).toLocaleString()}>
							{formatAgo(row.created_at)}
						</span>
					{/if}
				{/snippet}

				{#snippet actions(row: OwnedUpload)}
					<div class="flex items-center gap-0.5">
						<button
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title={row.is_public ? 'Make private' : 'Make public'}
							onclick={() => toggleVisibility(row)}
						>
							{#if row.is_public}<Lock class="size-4" />{:else}<Globe class="size-4" />{/if}
						</button>
						<button
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Share link"
							onclick={() => openShare(row)}
						>
							<Share2 class="size-4" />
						</button>
						<button
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Rename"
							onclick={() => openRename(row)}
						>
							<Pencil class="size-4" />
						</button>
						<button
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
							title="Delete"
							onclick={() => (fileToDelete = row)}
						>
							<Trash2 class="size-4" />
						</button>
					</div>
				{/snippet}
			</PaginatedTable>
		</div>
	</div>
</div>

<!-- New folder -->
<Dialog.Root bind:open={showNewFolder}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>New folder</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-3">
			<Input
				bind:value={newFolderName}
				placeholder="Folder name"
				onkeydown={(e) => e.key === 'Enter' && submitNewFolder()}
			/>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={newFolderPublic} class="size-4 accent-primary" />
				<span class="flex items-center gap-1"><Globe class="size-3.5" /> Files here are public by default</span>
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (showNewFolder = false)}>Cancel</Button>
			<Button size="sm" disabled={!newFolderName.trim() || creatingFolder} onclick={submitNewFolder}>
				{#if creatingFolder}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{/if}Create
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete folder -->
<Dialog.Root open={!!folderToDelete} onOpenChange={(o) => !o && (folderToDelete = null)}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete “{folderToDelete?.name}”?</Dialog.Title>
			<Dialog.Description>
				This permanently deletes the folder and everything inside it — subfolders and files. This
				can't be undone.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (folderToDelete = null)}>Cancel</Button>
			<Button variant="destructive" size="sm" disabled={deletingFolder} onclick={confirmDeleteFolder}>
				{#if deletingFolder}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{/if}Delete
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Rename file -->
<Dialog.Root open={!!fileToRename} onOpenChange={(o) => !o && (fileToRename = null)}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Rename file</Dialog.Title>
		</Dialog.Header>
		<Input bind:value={renameValue} onkeydown={(e) => e.key === 'Enter' && submitRename()} />
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (fileToRename = null)}>Cancel</Button>
			<Button size="sm" disabled={!renameValue.trim() || renaming} onclick={submitRename}>
				{#if renaming}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{/if}Save
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete file -->
<Dialog.Root open={!!fileToDelete} onOpenChange={(o) => !o && (fileToDelete = null)}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete “{fileToDelete?.filename}”?</Dialog.Title>
			<Dialog.Description>This permanently deletes the file. This can't be undone.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (fileToDelete = null)}>Cancel</Button>
			<Button variant="destructive" size="sm" disabled={deletingFile} onclick={confirmDeleteFile}>
				{#if deletingFile}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{/if}Delete
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Share link -->
<Dialog.Root open={!!shareTarget} onOpenChange={(o) => !o && (shareTarget = null)}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Share “{shareTarget?.filename}”</Dialog.Title>
			<Dialog.Description>
				{#if sharePublic}
					This file is public — the link is permanent.
				{:else}
					A private, time-limited link (expires {shareExpiry ? new Date(shareExpiry).toLocaleString() : 'in 24h'}).
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if sharing}
			<div class="flex items-center justify-center py-6 text-sm text-muted-foreground">
				<Loader2 class="mr-2 size-4 animate-spin" /> Generating link…
			</div>
		{:else if shareUrl}
			<div class="flex items-center gap-2">
				<Input value={shareUrl} readonly class="font-mono text-xs" />
				<Button size="icon" variant="outline" class="shrink-0" onclick={copyShare} title="Copy">
					{#if copied}<Check class="size-4 text-primary" />{:else}<Copy class="size-4" />{/if}
				</Button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
