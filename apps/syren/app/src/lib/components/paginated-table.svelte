<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { ArrowUp, ArrowDown, ArrowUpDown, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from '@lucide/svelte';
	import { Input } from '@syren/ui/input';
	import { Button } from '@syren/ui/button';

	interface Column {
		key: string;
		label: string;
		sortable?: boolean;
		class?: string;
	}

	const {
		columns,
		load,
		rowKey,
		cell,
		actions,
		searchPlaceholder = 'Search',
		initialSort,
		pageSize = 25,
		refreshSignal,
		emptyLabel = 'No results'
	}: {
		columns: Column[];
		load: (params: {
			limit: number;
			offset: number;
			sort?: string;
			order?: 'asc' | 'desc';
			q?: string;
		}) => Promise<{ items: T[]; total: number }>;
		rowKey: (row: T) => string;
		/** Renders one cell. Parent switches on `key` to pick what to render. */
		cell: Snippet<[row: T, key: string]>;
		actions?: Snippet<[row: T]>;
		searchPlaceholder?: string;
		initialSort?: { field: string; order: 'asc' | 'desc' };
		pageSize?: number;
		refreshSignal?: unknown;
		emptyLabel?: string;
	} = $props();

	let currentPageSize = $state(pageSize);
	let offset = $state(0);
	let sort = $state<string | undefined>(initialSort?.field);
	let order = $state<'asc' | 'desc' | undefined>(initialSort?.order);
	let q = $state('');
	let debouncedQ = $state('');

	let items = $state<T[]>([]);
	let total = $state(0);
	let loading = $state(false);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const current = q;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			if (debouncedQ !== current) {
				debouncedQ = current;
				offset = 0;
			}
		}, 300);
	});

	$effect(() => {
		void refreshSignal;
		void currentPageSize;
		void offset;
		void sort;
		void order;
		void debouncedQ;
		loading = true;
		load({ limit: currentPageSize, offset, sort, order, q: debouncedQ || undefined })
			.then((r) => { items = r.items; total = r.total; })
			.catch(() => { items = []; total = 0; })
			.finally(() => { loading = false; });
	});

	const totalPages = $derived(Math.max(1, Math.ceil(total / currentPageSize)));
	const currentPage = $derived(Math.floor(offset / currentPageSize) + 1);

	function toggleSort(key: string) {
		if (sort !== key) {
			sort = key;
			order = 'asc';
		} else if (order === 'asc') {
			order = 'desc';
		} else {
			sort = undefined;
			order = undefined;
		}
		offset = 0;
	}

	function goTo(page: number) {
		const clamped = Math.max(1, Math.min(totalPages, page));
		offset = (clamped - 1) * currentPageSize;
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<div class="relative max-w-xs flex-1">
			<Search class="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input bind:value={q} placeholder={searchPlaceholder} class="pl-8" />
		</div>
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span>{total} result{total === 1 ? '' : 's'}</span>
			<select
				bind:value={currentPageSize}
				onchange={() => (offset = 0)}
				class="rounded-md border border-input bg-background px-2 py-1 text-xs"
			>
				<option value={25}>25 / page</option>
				<option value={50}>50 / page</option>
				<option value={100}>100 / page</option>
			</select>
		</div>
	</div>

	<div class="overflow-x-auto rounded-md border border-border">
		<table class="w-full border-collapse text-sm">
			<thead class="bg-muted/50 text-xs uppercase text-muted-foreground">
				<tr>
					{#each columns as col (col.key)}
						<th class="px-3 py-2 text-left font-semibold {col.class ?? ''}">
							{#if col.sortable}
								<button
									type="button"
									onclick={() => toggleSort(col.key)}
									class="inline-flex items-center gap-1 hover:text-foreground"
								>
									{col.label}
									{#if sort === col.key && order === 'asc'}
										<ArrowUp class="h-3 w-3" />
									{:else if sort === col.key && order === 'desc'}
										<ArrowDown class="h-3 w-3" />
									{:else}
										<ArrowUpDown class="h-3 w-3 opacity-40" />
									{/if}
								</button>
							{:else}
								{col.label}
							{/if}
						</th>
					{/each}
					{#if actions}
						<th class="w-20 px-2"></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if loading && items.length === 0}
					<tr>
						<td colspan={columns.length + (actions ? 1 : 0)} class="px-3 py-8 text-center">
							<Loader2 class="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
						</td>
					</tr>
				{:else if items.length === 0}
					<tr>
						<td colspan={columns.length + (actions ? 1 : 0)} class="px-3 py-8 text-center text-sm text-muted-foreground">
							{emptyLabel}
						</td>
					</tr>
				{:else}
					{#each items as row (rowKey(row))}
						<tr class="border-t border-border transition-colors hover:bg-muted/30">
							{#each columns as col (col.key)}
								<td class="px-3 py-2 align-middle {col.class ?? ''}">
									{@render cell(row, col.key)}
								</td>
							{/each}
							{#if actions}
								<td class="px-2 py-2 text-right align-middle">
									{@render actions(row)}
								</td>
							{/if}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="flex items-center justify-end gap-1 text-xs">
		<span class="mr-2 text-muted-foreground">Page {currentPage} of {totalPages}</span>
		<Button variant="outline" size="icon" disabled={currentPage === 1 || loading} onclick={() => goTo(1)} title="First">
			<ChevronsLeft class="h-4 w-4" />
		</Button>
		<Button variant="outline" size="icon" disabled={currentPage === 1 || loading} onclick={() => goTo(currentPage - 1)} title="Previous">
			<ChevronLeft class="h-4 w-4" />
		</Button>
		<Button variant="outline" size="icon" disabled={currentPage === totalPages || loading} onclick={() => goTo(currentPage + 1)} title="Next">
			<ChevronRight class="h-4 w-4" />
		</Button>
		<Button variant="outline" size="icon" disabled={currentPage === totalPages || loading} onclick={() => goTo(totalPages)} title="Last">
			<ChevronsRight class="h-4 w-4" />
		</Button>
	</div>
</div>
