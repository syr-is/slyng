<script lang="ts">
	import * as Popover from '@syren/ui/popover';
	import { Input } from '@syren/ui/input';
	import { buttonVariants } from '@syren/ui/button';
	import { cn } from '@syren/ui/utils';
	import { tick } from 'svelte';
	import { Sticker, Search, LoaderCircle, ImageOff, Bookmark } from '@lucide/svelte';
	import type { ClipFeedEntry, ClipItem, ClipKind } from '@syren/types';
	import { clips } from '@syren/app-core/stores/clips.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { resolveGifs } from '@syren/app-core/stores/gifs.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { KLIPY_POWERED_BY } from './klipy-brand.js';

	// A toolbar-anchored picker for GIFs / stickers / clips / memes (Klipy) for the
	// post editor. Tapping a result calls `onpick(item)` — the editor inserts it as
	// a media node. The Klipy key never reaches the browser: all search/feed/track
	// calls go through the authed `/clips` proxy; only resolved CDN media loads
	// directly here. Ads Klipy injects inline (≈2 per page) render as sandboxed
	// iframes in their original slots — that's the monetization path, and the
	// mandatory "Powered by KLIPY" lockup stays visible while the picker is open.
	//
	// When `onpicksaved` is provided, a "Saved" tab exposes the signed-in user's own
	// hosted GIFs (P6, resolved via their syr manifest's `public_gifs` endpoint) so
	// they're insertable in-app. That tab shows no Klipy content, so the KLIPY lockup
	// hides while it's active.

	let {
		onpick,
		onpicksaved,
		disabled = false,
		side = 'bottom',
		align = 'start',
		triggerClass = 'size-8'
	}: {
		onpick: (item: ClipItem) => void;
		/** Insert one of the user's own hosted GIFs. Enables the "Saved" tab. */
		onpicksaved?: (item: { url: string; video: boolean }) => void;
		disabled?: boolean;
		/** Popover side — the post editor's toolbar is at the top (open down);
		 *  the chat composer is at the bottom (open up: `side="top"`). */
		side?: 'top' | 'bottom';
		align?: 'start' | 'center' | 'end';
		/** Extra classes for the trigger button (size differs per host). */
		triggerClass?: string;
	} = $props();

	const auth = getAuth();

	const KINDS: { kind: ClipKind; label: string }[] = [
		{ kind: 'gif', label: 'GIFs' },
		{ kind: 'sticker', label: 'Stickers' },
		{ kind: 'clip', label: 'Clips' },
		{ kind: 'meme', label: 'Memes' }
	];

	let open = $state(false);
	let kind = $state<ClipKind>('gif');
	let query = $state('');
	let entries = $state<ClipFeedEntry[]>([]);
	let page = $state(1);
	let hasNext = $state(false);
	let loading = $state(false);
	let error = $state(false);
	let loadedOnce = $state(false);
	let categories = $state<{ label: string; query: string; previewUrl?: string }[]>([]);
	let gridW = $state(0);
	let scroller = $state<HTMLElement | null>(null);
	let reqSeq = 0;

	// "Saved" tab (only when a consumer wired `onpicksaved`): the user's own hosted
	// GIFs, resolved reactively via their manifest. `savedQuery` is the debounced
	// search term so keystrokes don't fire a fetch each.
	const savedEnabled = $derived(!!onpicksaved && !!auth.identity?.did);
	let savedActive = $state(false);
	let savedQuery = $state('');
	const savedBundle = $derived(
		savedActive && auth.identity?.did
			? resolveGifs(auth.identity.did, auth.identity.syr_instance_url, savedQuery)
			: null
	);

	const q = $derived(query.trim());
	const mode = $derived<'search' | 'trending'>(q ? 'search' : 'trending');
	const visibleKinds = $derived(
		clips.aliveKinds ? KINDS.filter((k) => clips.aliveKinds!.includes(k.kind)) : KINDS
	);
	const kindLabel = $derived(KINDS.find((k) => k.kind === kind)?.label.toLowerCase() ?? 'gifs');

	// Masonry: a CSS-columns grid; we measure its width to scale ad iframes (which
	// have fixed creative dimensions) down into a column without distortion.
	const COLS = 3;
	const GAP = 8;
	// Fallback ≈ a 3-column split of the popover (min(92vw,420) − padding) so ads
	// mount close to their final size instead of jumping when gridW measures.
	const colW = $derived(gridW ? Math.floor((gridW - GAP * (COLS - 1)) / COLS) : 130);

	// (Re)load page 1 whenever the kind or the (debounced) query changes while open.
	$effect(() => {
		if (!open || savedActive) return;
		const k = kind;
		const term = q;
		const mine = ++reqSeq;
		loading = true;
		error = false;
		const t = setTimeout(() => void firstPage(mine, k, term), term ? 300 : 0);
		return () => clearTimeout(t);
	});

	// Debounce the search term feeding the Saved tab (own hosted GIFs).
	$effect(() => {
		if (!open || !savedActive) return;
		const term = q;
		const t = setTimeout(() => (savedQuery = term), term ? 300 : 0);
		return () => clearTimeout(t);
	});

	// Category chips for the active kind (shown when not searching).
	$effect(() => {
		if (!open || savedActive) return;
		const k = kind;
		void clips.loadCategories(k).then((c) => {
			if (kind === k) categories = c;
		});
	});

	// If Klipy reports the active kind unhealthy, snap to the first available tab
	// so the picker never sits on a hidden kind with no highlighted tab.
	$effect(() => {
		const alive = clips.aliveKinds;
		if (alive && !alive.includes(kind) && visibleKinds[0]) kind = visibleKinds[0].kind;
	});

	// Reset to a fresh trending view when the picker closes, so reopening never
	// flashes the previous query/results before the new load resolves.
	$effect(() => {
		if (!open) {
			query = '';
			savedQuery = '';
			savedActive = false;
			entries = [];
			loadedOnce = false;
			error = false;
		}
	});

	async function firstPage(mine: number, k: ClipKind, term: string) {
		const res = await clips.loadFeed({
			kind: k,
			mode: term ? 'search' : 'trending',
			...(term ? { q: term } : {}),
			page: 1
		});
		if (mine !== reqSeq) return;
		loadedOnce = true;
		loading = false;
		if (!res) {
			error = true;
			entries = [];
			return;
		}
		entries = res.entries;
		page = res.page;
		hasNext = res.hasNext;
		void ensureFilled(mine);
	}

	// Bootstrap the infinite scroll: `onScroll` → `more()` can only ever fire once
	// the results container overflows, but a first page of wide/short trending
	// tiles frequently doesn't fill the tall box on desktop — leaving the feed
	// frozen at page 1 with no way to load more. Keep paging until the container is
	// actually scrollable, there's nothing more, or the request was superseded.
	async function ensureFilled(mine: number) {
		for (let i = 0; i < 8; i++) {
			await tick();
			const el = scroller;
			if (!el || mine !== reqSeq || !hasNext) return;
			if (el.scrollHeight > el.clientHeight + 1) return;
			await more();
			if (mine !== reqSeq) return;
		}
	}

	async function more() {
		if (loading || !hasNext) return;
		const mine = reqSeq;
		loading = true;
		const res = await clips.loadFeed({
			kind,
			mode,
			...(q ? { q } : {}),
			page: page + 1
		});
		if (mine !== reqSeq) return;
		loading = false;
		if (res) {
			entries = [...entries, ...res.entries];
			page = res.page;
			hasNext = res.hasNext;
		}
	}

	function onScroll(e: Event) {
		if (savedActive) return; // saved GIFs aren't paginated (single manifest page)
		const el = e.currentTarget as HTMLElement;
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 280) void more();
	}

	function choose(item: ClipItem) {
		// Klipy 'view' engagement signal on pick (attribution requirement).
		if (item.slug) clips.track({ kind: item.kind, slug: item.slug, action: 'view' });
		onpick(item);
		open = false;
	}

	function chooseSaved(entry: { url: string; mime_type?: string }) {
		onpicksaved?.({ url: entry.url, video: (entry.mime_type ?? '').startsWith('video/') });
		open = false;
	}

	function searchCategory(c: { query: string }) {
		query = c.query;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		{disabled}
		class={cn(
			buttonVariants({ variant: 'ghost', size: 'icon' }),
			'shrink-0 text-muted-foreground',
			triggerClass
		)}
		aria-label="GIFs, stickers & memes"
		title="GIFs, stickers & memes"
	>
		<Sticker class="size-4" />
	</Popover.Trigger>
	<Popover.Content
		class="flex max-h-[var(--bits-popover-content-available-height)] w-[min(92vw,420px)] flex-col overflow-hidden p-0"
		{align}
		{side}
		sideOffset={8}
	>
		<!-- Kind tabs (only kinds Klipy reports healthy) + optional "Saved" tab -->
		<div class="flex shrink-0 gap-1 overflow-x-auto border-b p-2">
			{#each visibleKinds as t (t.kind)}
				<button
					type="button"
					onclick={() => {
						savedActive = false;
						kind = t.kind;
					}}
					class={cn(
						'shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
						!savedActive && kind === t.kind
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-muted'
					)}
				>
					{t.label}
				</button>
			{/each}
			{#if savedEnabled}
				<button
					type="button"
					onclick={() => (savedActive = true)}
					class={cn(
						'ml-auto flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
						savedActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
					)}
				>
					<Bookmark class="size-3.5" /> Saved
				</button>
			{/if}
		</div>

		<!-- Search -->
		<div class="relative shrink-0 p-2">
			<Search
				class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<!-- KLIPY brand guideline (required): identify the source with KLIPY capitalized. -->
			<Input
				bind:value={query}
				placeholder={savedActive ? 'Search your GIFs' : 'Search KLIPY'}
				class="h-9 pl-9"
			/>
		</div>

		<!-- Category chips (browse) -->
		{#if !savedActive && !q && categories.length}
			<div class="flex shrink-0 gap-1.5 overflow-x-auto px-2 pb-2">
				{#each categories.slice(0, 14) as c (c.query)}
					<button
						type="button"
						onclick={() => searchCategory(c)}
						class="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
					>
						{c.label}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Results -->
		<div
			bind:this={scroller}
			class="max-h-[46vh] min-h-40 overflow-y-auto [scrollbar-gutter:stable] px-2 pb-2"
			onscroll={onScroll}
		>
			{#if savedActive}
				<!-- The user's own hosted GIFs (P6), inserted as a plain CDN url. -->
				{#if savedBundle?.loading && savedBundle.entries.length === 0}
					<div class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
						<LoaderCircle class="size-4 animate-spin" /> Loading…
					</div>
				{:else if savedBundle?.error}
					<div
						class="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground"
					>
						<ImageOff class="size-5" />
						<p>Couldn't load your GIFs.</p>
					</div>
				{:else if !savedBundle || savedBundle.entries.length === 0}
					<div class="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
						<Bookmark class="size-6 text-muted-foreground" />
						<p class="text-sm font-medium">
							{q ? `No saved GIFs for “${q}”.` : 'No saved GIFs yet.'}
						</p>
						{#if !q}
							<p class="max-w-[16rem] text-xs text-muted-foreground">
								Upload GIFs in Settings → GIFs and they'll show up here.
							</p>
						{/if}
					</div>
				{:else}
					<div style="column-count:{COLS};column-gap:{GAP}px">
						{#each savedBundle.entries as g (g.local_id)}
							<div class="mb-2 break-inside-avoid" style="break-inside:avoid">
								<button
									type="button"
									onclick={() => chooseSaved(g)}
									class="block w-full overflow-hidden rounded-md bg-muted transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
									title={g.tags?.join(', ') || 'Insert'}
									aria-label={g.tags?.join(', ') || 'Insert saved GIF'}
								>
									{#if (g.mime_type ?? '').startsWith('video/')}
										<!-- svelte-ignore a11y_media_has_caption -->
										<video
											src={proxied(g.url)}
											muted
											loop
											autoplay
											playsinline
											class="w-full object-cover"
										></video>
									{:else}
										<img
											src={proxied(g.thumbnail_url ?? g.url)}
											alt={g.tags?.join(', ') ?? ''}
											loading="lazy"
											class="w-full object-cover"
										/>
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/if}
			{:else if loadedOnce && !clips.available}
				<div class="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
					<Sticker class="size-6 text-muted-foreground" />
					<p class="text-sm font-medium">GIFs aren't set up on this instance.</p>
					<p class="max-w-[16rem] text-xs text-muted-foreground">
						They need a Klipy key (<code>KLIPY_WEB</code>) configured server-side. Everything else
						in the editor works without it.
					</p>
				</div>
			{:else if loading && entries.length === 0}
				<div class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
					<LoaderCircle class="size-4 animate-spin" /> Loading…
				</div>
			{:else if error && entries.length === 0}
				<div class="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
					<ImageOff class="size-5" />
					<p>Couldn't load right now.</p>
					<button
						type="button"
						class="text-xs font-medium text-primary hover:underline"
						onclick={() => {
							error = false;
							loading = true;
							void firstPage(++reqSeq, kind, q);
						}}>Try again</button
					>
				</div>
			{:else if entries.length === 0}
				<p class="py-10 text-center text-sm text-muted-foreground">
					{q ? `No ${kindLabel} for “${q}”.` : `No ${kindLabel} right now.`}
				</p>
			{:else}
				<div bind:clientWidth={gridW} style="column-count:{COLS};column-gap:{GAP}px">
					{#each entries as entry, i (i)}
						<div class="mb-2 break-inside-avoid" style="break-inside:avoid">
							{#if entry.type === 'ad'}
								{@const s = Math.min(1, colW / entry.ad.width)}
								<div
									class="relative overflow-hidden rounded-md bg-muted"
									style="width:{colW}px;height:{Math.max(40, Math.round(entry.ad.height * s))}px"
								>
									<!-- Cross-origin Klipy ad creative: allow-same-origin gives it Klipy's
									     origin (not ours), so it can't reach our DOM; allow-popups(-to-escape)
									     is kept so click-through works. no-referrer avoids leaking the route. -->
									<iframe
										src={entry.ad.url}
										title="Sponsored"
										loading="lazy"
										scrolling="no"
										referrerpolicy="no-referrer"
										sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
										style="width:{entry.ad.width}px;height:{entry.ad
											.height}px;border:0;transform:scale({s});transform-origin:top left"
									></iframe>
									<span
										class="pointer-events-none absolute top-1 right-1 rounded bg-foreground/60 px-1 text-[9px] font-medium text-background"
										>Ad</span
									>
								</div>
							{:else}
								{@const item = entry.item}
								<button
									type="button"
									onclick={() => choose(item)}
									class="block w-full overflow-hidden rounded-md bg-muted transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
									title={item.title ?? 'Insert'}
									aria-label={item.title ?? `Insert ${item.kind}`}
									style="aspect-ratio:{item.width}/{item.height}"
								>
									{#if item.kind === 'clip'}
										<video
											src={item.mp4Url ?? item.url}
											muted
											loop
											autoplay
											playsinline
											class="h-full w-full object-cover"
										></video>
									{:else}
										<img
											src={item.previewUrl}
											alt={item.title ?? ''}
											loading="lazy"
											class="h-full w-full object-cover"
										/>
									{/if}
								</button>
							{/if}
						</div>
					{/each}
					{#if loading && entries.length > 0}
						<div class="flex justify-center py-3 text-muted-foreground">
							<LoaderCircle class="size-4 animate-spin" />
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- KLIPY brand guideline: the official "Powered by KLIPY" lockup, kept
		     visible whenever Klipy content is on screen. The Saved tab shows only the
		     user's own hosted GIFs (no Klipy), so the lockup hides there. -->
		{#if !savedActive}
			<div class="flex shrink-0 items-center justify-center border-t px-3 py-2 text-muted-foreground">
				<span class="inline-flex [&_svg]:h-4 [&_svg]:w-auto">{@html KLIPY_POWERED_BY}</span>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
