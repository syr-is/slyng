<script lang="ts">
	import { Hash, Volume2, GripVertical, Plus, Pencil, Trash2, FolderPlus, ChevronDown, ChevronRight, Shield } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Dialog from '@syren/ui/dialog';
	import * as Form from '@syren/ui/form';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { CreateCategoryInputSchema } from '@syren/types';
	import { api } from '@syren/app-core/api';
	import {
		getServerState,
		setServerChannels,
		setServerCategories,
		reorderChannels,
		reorderCategories
	} from '@syren/app-core/stores/servers.svelte';
	import { getPerms } from '@syren/app-core/stores/perms.svelte';
	import ChannelEditDialog from '../channel-edit-dialog.svelte';
	import CreateChannelDialog from '../create-channel-dialog.svelte';
	import ChannelPermissionEditor from '../channel-permission-editor.svelte';

	const { serverId }: { serverId: string } = $props();

	const serverState = getServerState();
	const perms = getPerms();
	const canManage = $derived(perms.canManageChannels);

	const categories = $derived(serverState.categories);
	const uncategorized = $derived(
		serverState.channels.filter((c) => !c.category_id).sort((a, b) => a.position - b.position)
	);

	function channelsInCategory(catId: string) {
		return serverState.channels
			.filter((c) => String(c.category_id) === catId)
			.sort((a, b) => a.position - b.position);
	}

	let editChannel = $state<{ id: string; name: string; topic: string } | null>(null);
	let showCreateChannel = $state(false);
	let createChannelCategoryId = $state<string | undefined>(undefined);
	let showCreateCategory = $state(false);
	let permEditor = $state<{ scopeType: 'channel' | 'category'; scopeId: string; scopeName: string; channelType?: 'text' | 'voice' } | null>(null);
	let collapsed = $state<Set<string>>(new Set());

	// Generated `CreateCategoryInputSchema` is `{ name: string }`; layer
	// the same `min(1).max(100)` ceiling we apply to channel/server names.
	const CategorySchema = CreateCategoryInputSchema.extend({
		name: z.string().min(1, 'Category name is required').max(100)
	});
	const categoryForm = superForm(defaults(zod4(CategorySchema)), {
		SPA: true,
		validators: zod4Client(CategorySchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			try {
				await api.categories.create(serverId, { name: f.data.name.trim() });
				f.data.name = '';
				showCreateCategory = false;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Failed to create category');
			}
		}
	});
	const { form: categoryFormData, enhance: categoryEnhance, submitting: categorySubmitting } = categoryForm;

	function toggleCollapse(catId: string) {
		const next = new Set(collapsed);
		if (next.has(catId)) next.delete(catId);
		else next.add(catId);
		collapsed = next;
	}

	async function refreshChannels() {
		if (!serverId) return;
		const [channels, cats] = await Promise.all([
			api.servers.channels(serverId),
			api.categories.list(serverId).catch(() => [])
		]);
		setServerChannels(channels as any[]);
		setServerCategories(cats as any[]);
	}

	async function handleCreateChannel(name: string, type: string) {
		try {
			await api.servers.createChannel(serverId, { name, type, category_id: createChannelCategoryId });
			createChannelCategoryId = undefined;
			await refreshChannels();
		} catch {
			toast.error('Failed to create channel');
		}
	}

	async function deleteChannel(channelId: string) {
		try {
			await api.channels.delete(channelId);
			await refreshChannels();
			toast.success('Channel deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete');
		}
	}

	async function deleteCategory(catId: string) {
		try {
			await api.categories.delete(catId);
			toast.success('Category deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	// ── Drag-and-drop ──

	let dragType = $state<'channel' | 'category' | null>(null);
	let draggedId = $state<string | null>(null);
	let dropTargetId = $state<string | null>(null);
	let dropTargetKind = $state<'channel' | 'category-header' | 'category' | null>(null);
	let dropSide = $state<'above' | 'below'>('above');

	function startChannelDrag(e: DragEvent, channelId: string) {
		if (!e.dataTransfer) return;
		dragType = 'channel';
		draggedId = channelId;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', channelId);
	}

	function startCategoryDrag(e: DragEvent, catId: string) {
		if (!e.dataTransfer) return;
		dragType = 'category';
		draggedId = catId;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', catId);
	}

	function onChannelDragOver(e: DragEvent, channelId: string) {
		if (dragType !== 'channel' || !draggedId || draggedId === channelId) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropTargetId = channelId;
		dropTargetKind = 'channel';
		dropSide = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
	}

	function onCategoryHeaderDragOver(e: DragEvent, catId: string) {
		if (!draggedId) return;
		if (dragType === 'channel') {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			dropTargetId = catId;
			dropTargetKind = 'category-header';
		}
	}

	function onCategoryWrapperDragOver(e: DragEvent, catId: string) {
		if (!draggedId) return;
		if (dragType === 'channel') {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			dropTargetId = catId;
			dropTargetKind = 'category-header';
		} else if (dragType === 'category' && draggedId !== catId) {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			dropTargetId = catId;
			dropTargetKind = 'category';
			dropSide = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
		}
	}

	function onUncategorizedZoneDragOver(e: DragEvent) {
		if (dragType !== 'channel' || !draggedId) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropTargetId = '__uncategorized__';
		dropTargetKind = 'channel';
	}

	function onDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (related && (e.currentTarget as HTMLElement).contains(related)) return;
		e.stopPropagation();
		dropTargetId = null;
		dropTargetKind = null;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!draggedId || !dropTargetId) return resetDrag();
		if (dragType === 'channel') handleChannelDrop();
		else if (dragType === 'category') handleCategoryDrop();
		resetDrag();
	}

	function handleChannelDrop() {
		const draggedChannel = serverState.channels.find((c) => c.id === draggedId);
		if (!draggedChannel) return;

		if (dropTargetKind === 'category-header' || dropTargetId === '__uncategorized__') {
			const targetCatId = dropTargetId === '__uncategorized__' ? null : dropTargetId!;
			const existing = targetCatId ? channelsInCategory(targetCatId) : [...uncategorized];
			const list = [...existing.filter((c) => c.id !== draggedId), draggedChannel];
			const ids = list.map((c) => c.id);
			reorderChannels(ids, targetCatId);
			commitChannelReorder(ids, targetCatId);
			return;
		}

		const targetChannel = serverState.channels.find((c) => c.id === dropTargetId);
		if (!targetChannel) return;
		const targetCatId = targetChannel.category_id ? String(targetChannel.category_id) : null;
		const groupChannels = targetCatId ? [...channelsInCategory(targetCatId)] : [...uncategorized];
		const filtered = groupChannels.filter((c) => c.id !== draggedId);
		const toIdx = filtered.findIndex((c) => c.id === dropTargetId);
		let insertIdx = toIdx < 0 ? filtered.length : toIdx;
		if (dropSide === 'below') insertIdx++;
		filtered.splice(insertIdx, 0, draggedChannel);
		const ids = filtered.map((c) => c.id);
		reorderChannels(ids, targetCatId);
		commitChannelReorder(ids, targetCatId);
	}

	function handleCategoryDrop() {
		if (dropTargetKind !== 'category') return;
		const list = [...categories];
		const fromIdx = list.findIndex((c) => c.id === draggedId);
		const toIdx = list.findIndex((c) => c.id === dropTargetId);
		if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
		const [item] = list.splice(fromIdx, 1);
		let insertIdx = list.findIndex((c) => c.id === dropTargetId);
		if (insertIdx < 0) insertIdx = list.length;
		if (dropSide === 'below') insertIdx++;
		list.splice(insertIdx, 0, item);
		const categoryIds = list.map((c) => c.id);
		reorderCategories(categoryIds);
		commitCategoryReorder(categoryIds);
	}

	function resetDrag() {
		dragType = null;
		draggedId = null;
		dropTargetId = null;
		dropTargetKind = null;
	}

	async function commitChannelReorder(channelIds: string[], categoryId: string | null) {
		try {
			await api.channels.reorder(serverId, channelIds, categoryId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
			await refreshChannels();
		}
	}

	async function commitCategoryReorder(categoryIds: string[]) {
		try {
			await api.categories.reorder(serverId, categoryIds);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
			await refreshChannels();
		}
	}
</script>

{#snippet channelItem(channel: { id: string; name?: string; type: string; topic?: string })}
	{@const isDragged = dragType === 'channel' && draggedId === channel.id}
	{@const isDropTarget = dropTargetKind === 'channel' && dropTargetId === channel.id}
	<div
		class="relative"
		ondragover={(e) => onChannelDragOver(e, channel.id)}
		ondragleave={onDragLeave}
		ondrop={onDrop}
	>
		{#if isDropTarget && dropSide === 'above'}
			<div class="absolute -top-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
		{/if}
		<div
			class="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 {isDragged ? 'opacity-40' : ''}"
			draggable={canManage ? 'true' : undefined}
			ondragstart={(e) => startChannelDrag(e, channel.id)}
			ondragend={resetDrag}
		>
			<div class="flex items-center gap-2">
				{#if canManage}
					<GripVertical class="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
				{/if}
				{#if channel.type === 'voice'}
					<Volume2 class="h-4 w-4 shrink-0 text-muted-foreground" />
				{:else}
					<Hash class="h-4 w-4 shrink-0 text-muted-foreground" />
				{/if}
				<span class="text-sm font-medium text-foreground">{channel.name}</span>
				<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{channel.type}</span>
			</div>
			{#if canManage}
				<div class="flex gap-1">
					{#if perms.canManageRoles}
						<button
							onclick={() => (permEditor = { scopeType: 'channel', scopeId: channel.id, scopeName: channel.name ?? 'Channel', channelType: channel.type === 'voice' ? 'voice' : 'text' })}
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Permissions"
						>
							<Shield class="h-4 w-4" />
						</button>
					{/if}
					<button
						onclick={() => (editChannel = { id: channel.id, name: channel.name ?? '', topic: channel.topic ?? '' })}
						class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Edit"
					>
						<Pencil class="h-4 w-4" />
					</button>
					<button
						onclick={() => deleteChannel(channel.id)}
						class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
						title="Delete"
					>
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			{/if}
		</div>
		{#if isDropTarget && dropSide === 'below'}
			<div class="absolute -bottom-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
		{/if}
	</div>
{/snippet}

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<p class="text-xs text-muted-foreground">
			{serverState.channels.length} channel{serverState.channels.length === 1 ? '' : 's'} · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · drag to reorder
		</p>
		{#if canManage}
			<div class="flex gap-2">
				<Button size="sm" variant="outline" onclick={() => (showCreateCategory = true)}>
					<FolderPlus class="mr-1.5 h-4 w-4" /> Category
				</Button>
				<Button size="sm" onclick={() => { createChannelCategoryId = undefined; showCreateChannel = true; }}>
					<Plus class="mr-1.5 h-4 w-4" /> Channel
				</Button>
			</div>
		{/if}
	</div>

	<!-- Uncategorized channels -->
	<div>
		<div class="mb-1.5 flex items-center justify-between">
			<span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Uncategorized</span>
		</div>
		{#if uncategorized.length === 0 && dragType !== 'channel'}
			<p class="rounded-md border border-border bg-muted/20 py-4 text-center text-sm text-muted-foreground">
				No uncategorized channels.
			</p>
		{/if}

		<div class="space-y-1">
			{#each uncategorized as channel (channel.id)}
				{@render channelItem(channel)}
			{/each}
		</div>

		{#if dragType === 'channel' && uncategorized.every((c) => c.id !== draggedId) }
			<div
				class="mt-1 rounded-md border border-dashed px-2 py-2 text-center text-xs transition-colors
					{dropTargetId === '__uncategorized__'
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground'}"
				ondragover={onUncategorizedZoneDragOver}
				ondragleave={onDragLeave}
				ondrop={onDrop}
			>
				Drop here to uncategorize
			</div>
		{/if}
	</div>

	<!-- Categories -->
	{#each categories as cat (cat.id)}
		{@const catChannels = channelsInCategory(cat.id)}
		{@const isCollapsed = collapsed.has(cat.id)}
		{@const isCatDragged = dragType === 'category' && draggedId === cat.id}
		{@const isCatDropTarget = dropTargetKind === 'category' && dropTargetId === cat.id}
		{@const isCatHeaderDrop = dragType === 'channel' && dropTargetKind === 'category-header' && dropTargetId === cat.id}
		<div
			class="relative {isCatDragged ? 'opacity-40' : ''}"
			ondragover={(e) => onCategoryWrapperDragOver(e, cat.id)}
			ondragleave={onDragLeave}
			ondrop={onDrop}
		>
			{#if isCatDropTarget && dropSide === 'above'}
				<div class="absolute -top-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
			{/if}

			<!-- Category header -->
			<div
				class="flex items-center justify-between rounded-md border px-3 py-2 transition-colors
					{isCatHeaderDrop ? 'border-primary bg-primary/10' : 'border-border bg-card/50'}"
				draggable={canManage ? 'true' : undefined}
				ondragstart={(e) => startCategoryDrag(e, cat.id)}
				ondragend={resetDrag}
				ondragover={(e) => onCategoryHeaderDragOver(e, cat.id)}
				ondragleave={onDragLeave}
			>
				<div class="flex items-center gap-2">
					{#if canManage}
						<GripVertical class="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
					{/if}
					<button type="button" onclick={() => toggleCollapse(cat.id)} class="flex items-center gap-1 text-muted-foreground hover:text-foreground">
						{#if isCollapsed}
							<ChevronRight class="h-3.5 w-3.5" />
						{:else}
							<ChevronDown class="h-3.5 w-3.5" />
						{/if}
					</button>
					<span class="text-sm font-semibold text-foreground">{cat.name}</span>
					<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{catChannels.length}
					</span>
				</div>
				{#if canManage}
					<div class="flex gap-1">
						{#if perms.canManageRoles}
							<button
								onclick={() => (permEditor = { scopeType: 'category', scopeId: cat.id, scopeName: cat.name })}
								class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
								title="Permissions"
							>
								<Shield class="h-4 w-4" />
							</button>
						{/if}
						<button
							onclick={() => { createChannelCategoryId = cat.id; showCreateChannel = true; }}
							class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Create channel in {cat.name}"
						>
							<Plus class="h-4 w-4" />
						</button>
						<button
							onclick={() => deleteCategory(cat.id)}
							class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
							title="Delete category"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/if}
			</div>

			<!-- Category channels -->
			{#if !isCollapsed}
				<div class="ml-4 mt-1 space-y-1 border-l border-border pl-3">
					{#each catChannels as channel (channel.id)}
						{@render channelItem(channel)}
					{/each}
					{#if catChannels.length === 0}
						<p class="py-2 text-center text-xs text-muted-foreground">No channels in this category.</p>
					{/if}
				</div>
			{/if}

			{#if isCatDropTarget && dropSide === 'below'}
				<div class="absolute -bottom-[3px] left-0 right-0 z-10 h-[2px] rounded-full bg-primary"></div>
			{/if}
		</div>
	{/each}
</div>

<CreateChannelDialog
	open={showCreateChannel}
	onClose={() => (showCreateChannel = false)}
	onCreate={handleCreateChannel}
/>

{#if editChannel}
	<ChannelEditDialog
		open={true}
		channelId={editChannel.id}
		channelName={editChannel.name}
		channelTopic={editChannel.topic}
		onClose={() => (editChannel = null)}
		onUpdated={refreshChannels}
	/>
{/if}

<Dialog.Root
	open={showCreateCategory}
	onOpenChange={(v) => {
		if (!v) {
			showCreateCategory = false;
			$categoryFormData.name = '';
		}
	}}
>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Create Category</Dialog.Title>
		</Dialog.Header>
		<form method="POST" use:categoryEnhance class="space-y-4 py-4">
			<Form.Field form={categoryForm} name="name">
				<Form.Control>
					{#snippet children({ props })}
						<Input {...props} bind:value={$categoryFormData.name} placeholder="Category name" />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						showCreateCategory = false;
						$categoryFormData.name = '';
					}}
				>
					Cancel
				</Button>
				<Form.Button disabled={$categorySubmitting}>Create</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

{#if permEditor}
	<ChannelPermissionEditor
		open={true}
		{serverId}
		scopeType={permEditor.scopeType}
		scopeId={permEditor.scopeId}
		scopeName={permEditor.scopeName}
		channelType={permEditor.channelType}
		onClose={() => (permEditor = null)}
	/>
{/if}
