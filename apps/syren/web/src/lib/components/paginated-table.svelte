<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import {
		ArrowUp,
		ArrowDown,
		ArrowUpDown,
		Search,
		ChevronLeft,
		ChevronRight,
		ChevronsLeft,
		ChevronsRight,
		Loader2,
		Filter,
		X
	} from '@lucide/svelte';
	import { Input } from '@syren/ui/input';
	import { Button } from '@syren/ui/button';

	interface Column {
		key: string;
		label: string;
		sortable?: boolean;
		class?: string;
	}

	type FilterDef =
		| { key: string; kind: 'text'; label: string; placeholder?: string; mono?: boolean }
		| { key: string; kind: 'date'; label: string }
		| {
				key: string;
				kind: 'select';
				label: string;
				options: { value: string; label: string }[];
				placeholder?: string;
		  }
		| { key: string; kind: 'custom'; label: string };

	const {
		columns,
		load,
		rowKey,
		cell,
		actions,
		filters = [],
		filterSlot,
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
			filters: Record<string, unknown>;
		}) => Promise<{ items: T[]; total: number }>;
		rowKey: (row: T) => string;
		/** Renders one cell. Parent switches on `key` to pick what to render. */
		cell: Snippet<[row: T, key: string]>;
		actions?: Snippet<[row: T]>;
		filters?: FilterDef[];
		/** Invoked for every filter whose `kind === 'custom'`. */
		filterSlot?: Snippet<[filter: FilterDef, value: unknown, setValue: (v: unknown) => void]>;
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

	// Filter state: one entry per declared filter, keyed by `filter.key`.
	// Raw strings for text/date/select; opaque for custom. Initialised to
	// empty strings so `{}` reactivity works and clear button detection is
	// simple.
	function blankValueFor(f: FilterDef): unknown {
		return f.kind === 'select' ? '' : '';
	}

	let filterValues = $state<Record<string, unknown>>(
		Object.fromEntries(filters.map((f) => [f.key, blankValueFor(f)]))
	);
	let debouncedFilters = $state<Record<string, unknown>>({ ...filterValues });

	let items = $state<T[]>([]);
	let total = $state(0);
	let loading = $state(false);

	// Single shared debounce covering `q` AND every filter key. Flushing any
	// resets pagination to page 1 so page numbers don't outrun the narrowed
	// result set.
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		// Read every input so the effect re-runs on any change.
		const currentQ = q;
		const snapshot: Record<string, unknown> = {};
		for (const f of filters) snapshot[f.key] = filterValues[f.key];
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			const qChanged = debouncedQ !== currentQ;
			let filtersChanged = false;
			for (const f of filters) {
				if (debouncedFilters[f.key] !== snapshot[f.key]) {
					filtersChanged = true;
					break;
				}
			}
			if (qChanged) debouncedQ = currentQ;
			if (filtersChanged) debouncedFilters = snapshot;
			if (qChanged || filtersChanged) offset = 0;
		}, 300);
	});

	/**
	 * Coerce raw filter values into what the backend expects. For `date`
	 * kinds the raw `datetime-local` string becomes an ISO timestamp.
	 */
	function shapeFiltersForLoad(raw: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const f of filters) {
			const v = raw[f.key];
			if (v === undefined || v === null || v === '') continue;
			if (f.kind === 'text') {
				const s = typeof v === 'string' ? v.trim() : String(v).trim();
				if (s) out[f.key] = s;
			} else if (f.kind === 'date') {
				const d = new Date(v as string);
				if (!isNaN(d.getTime())) out[f.key] = d.toISOString();
			} else {
				out[f.key] = v;
			}
		}
		return out;
	}

	$effect(() => {
		void refreshSignal;
		void currentPageSize;
		void offset;
		void sort;
		void order;
		void debouncedQ;
		void debouncedFilters;
		loading = true;
		load({
			limit: currentPageSize,
			offset,
			sort,
			order,
			q: debouncedQ || undefined,
			filters: shapeFiltersForLoad(debouncedFilters)
		})
			.then((r) => {
				items = r.items;
				total = r.total;
			})
			.catch(() => {
				items = [];
				total = 0;
			})
			.finally(() => {
				loading = false;
			});
	});

	const totalPages = $derived(Math.max(1, Math.ceil(total / currentPageSize)));
	const currentPage = $derived(Math.floor(offset / currentPageSize) + 1);

	const activeFilterCount = $derived(
		filters.reduce((n, f) => {
			const v = debouncedFilters[f.key];
			if (v === undefined || v === null || v === '') return n;
			return n + 1;
		}, 0)
	);

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

	function setFilter(key: string, value: unknown) {
		filterValues = { ...filterValues, [key]: value };
	}

	function clearAllFilters() {
		filterValues = Object.fromEntries(filters.map((f) => [f.key, blankValueFor(f)]));
	}
</script>

<div class="space-y-3">
	{#if filters.length > 0}
		<div class="grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each filters as f (f.key)}
				<div class="space-y-1">
					<label
						for="filter-{f.key}"
						class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
					>
						<Filter class="h-3 w-3" />
						{f.label}
					</label>
					{#if f.kind === 'text'}
						<Input
							id="filter-{f.key}"
							value={(filterValues[f.key] as string) ?? ''}
							oninput={(e) =>
								setFilter(f.key, (e.currentTarget as HTMLInputElement).value)}
							placeholder={f.placeholder ?? ''}
							class={'h-8 text-xs ' + (f.mono ? 'font-mono' : '')}
						/>
					{:else if f.kind === 'date'}
						<Input
							id="filter-{f.key}"
							type="datetime-local"
							value={(filterValues[f.key] as string) ?? ''}
							oninput={(e) =>
								setFilter(f.key, (e.currentTarget as HTMLInputElement).value)}
							class="h-8 text-xs"
						/>
					{:else if f.kind === 'select'}
						<select
							id="filter-{f.key}"
							value={(filterValues[f.key] as string) ?? ''}
							onchange={(e) =>
								setFilter(f.key, (e.currentTarget as HTMLSelectElement).value)}
							class="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs"
						>
							<option value="">{f.placeholder ?? 'Any'}</option>
							{#each f.options as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					{:else if f.kind === 'custom' && filterSlot}
						{@render filterSlot(f, filterValues[f.key], (v) => setFilter(f.key, v))}
					{/if}
				</div>
			{/each}
			{#if activeFilterCount > 0}
				<div class="sm:col-span-2 lg:col-span-4">
					<Button variant="ghost" size="sm" onclick={clearAllFilters} class="h-7 gap-1 text-xs">
						<X class="h-3 w-3" />
						Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
					</Button>
				</div>
			{/if}
		</div>
	{/if}

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
