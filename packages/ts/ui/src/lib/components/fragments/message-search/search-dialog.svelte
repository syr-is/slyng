<script lang="ts">
	import * as Dialog from '@slyng/ui/dialog';
	import * as Avatar from '@slyng/ui/avatar';
	import {
		Search,
		User,
		Hash,
		Paperclip,
		Calendar,
		Pin,
		X,
		Loader2,
		CornerDownLeft,
		Link as LinkIcon,
		Image as ImageIcon,
		Film,
		FileText,
		AtSign
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { getMembers } from '@slyng/app-core/stores/members.svelte';
	import { getServerState } from '@slyng/app-core/stores/servers.svelte';
	import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import {
		searchMessages,
		type SearchMessage
	} from '@slyng/app-core/stores/message-search.svelte';

	/**
	 * Discord-style message search. Opened from the channel header; searches
	 * every channel the member can read in the active server. Free text plus
	 * token filters (from / in / has / before / after / pinned) entered as
	 * chips with an autocomplete dropdown. Results jump to the message in its
	 * channel (same-channel scroll, cross-channel navigate + ?jump=).
	 */
	const {
		open,
		serverId,
		currentChannelId,
		onClose,
		onJump
	}: {
		open: boolean;
		serverId: string;
		currentChannelId: string;
		onClose: () => void;
		/** Same-channel jump: scroll + highlight a message already in the DOM. */
		onJump: (messageId: string) => void;
	} = $props();

	const PAGE = 25;

	type FilterKey = 'from' | 'mentions' | 'in' | 'has' | 'before' | 'after' | 'pinned';
	interface Chip {
		id: string;
		key: FilterKey;
		value: string;
		label: string;
	}

	const HAS_OPTIONS = ['link', 'file', 'image', 'video', 'embed'] as const;
	const FILTERS: { key: FilterKey; icon: typeof User; title: string; hint: string }[] = [
		{ key: 'from', icon: User, title: 'From a specific user', hint: 'from: user' },
		{ key: 'mentions', icon: AtSign, title: 'Mentions a specific user', hint: 'mentions: user' },
		{ key: 'in', icon: Hash, title: 'Sent in a specific channel', hint: 'in: channel' },
		{ key: 'has', icon: Paperclip, title: 'Includes a specific type of data', hint: 'has: link, file, image, video or embed' },
		{ key: 'after', icon: Calendar, title: 'Sent after a date', hint: 'after: yyyy-mm-dd' },
		{ key: 'before', icon: Calendar, title: 'Sent before a date', hint: 'before: yyyy-mm-dd' },
		{ key: 'pinned', icon: Pin, title: 'Pinned messages', hint: 'pinned: true' }
	];

	// ── token input state ──
	let chips = $state<Chip[]>([]);
	let text = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let dropdownOpen = $state(false);
	let dismissed = $state(false);
	let activeIndex = $state(0);

	// ── results state ──
	let results = $state<SearchMessage[]>([]);
	let total = $state(0);
	let searching = $state(false);
	let loadingMore = $state(false);
	let hasSearched = $state(false);

	const members = getMembers();
	const serverState = getServerState();

	// Detect a trailing `key:partial` token (value mode) or the trailing word
	// (filter-menu mode) at the caret. We only look at the tail of the text.
	const TOKEN_RE = /(?:^|\s)(from|mentions|in|has|before|after|pinned):(\S*)$/i;
	const WORD_RE = /(?:^|\s)(\S*)$/;

	const mode = $derived.by(() => {
		const m = text.match(TOKEN_RE);
		if (m) return { type: 'value' as const, key: m[1].toLowerCase() as FilterKey, partial: m[2] };
		const w = text.match(WORD_RE);
		return { type: 'filters' as const, partial: (w?.[1] ?? '').toLowerCase() };
	});

	interface SuggestItem {
		kind: 'filter' | 'user' | 'channel' | 'has' | 'pinned';
		label: string;
		sub?: string;
		icon?: typeof User;
		avatar?: string;
		fallback?: string;
		// payload
		fkey?: FilterKey;
		did?: string;
		channelId?: string;
		hasValue?: string;
		name?: string;
	}

	const textChannels = $derived(serverState.channels.filter((c) => c.type !== 'voice'));

	const suggestions = $derived.by<SuggestItem[]>(() => {
		if (mode.type === 'filters') {
			const p = mode.partial;
			return FILTERS.filter(
				(f) => !p || f.key.startsWith(p) || f.title.toLowerCase().includes(p)
			).map((f) => ({
				kind: 'filter' as const,
				label: f.title,
				sub: f.hint,
				icon: f.icon,
				fkey: f.key
			}));
		}
		const p = mode.partial.toLowerCase();
		if (mode.key === 'from' || mode.key === 'mentions') {
			return members.list
				.map((m) => {
					const profile = resolveProfile(m.user_id, m.syr_instance_url);
					const name = ((m as { nickname?: string }).nickname || displayName(profile, m.user_id)) as string;
					return {
						kind: 'user' as const,
						label: name,
						sub: m.user_id,
						avatar: profile.avatar_url ? proxied(profile.avatar_url) : undefined,
						fallback: name.slice(0, 2).toUpperCase(),
						did: m.user_id,
						name
					};
				})
				.filter((u) => !p || u.label.toLowerCase().includes(p) || u.did.toLowerCase().includes(p))
				.slice(0, 8);
		}
		if (mode.key === 'in') {
			return textChannels
				.filter((c) => !p || (c.name ?? '').toLowerCase().includes(p))
				.slice(0, 8)
				.map((c) => ({
					kind: 'channel' as const,
					label: `#${c.name ?? ''}`,
					icon: Hash,
					channelId: c.id,
					name: c.name ?? ''
				}));
		}
		if (mode.key === 'has') {
			return HAS_OPTIONS.filter((h) => !p || h.startsWith(p)).map((h) => ({
				kind: 'has' as const,
				label: h,
				sub: `has: ${h}`,
				icon: Paperclip,
				hasValue: h
			}));
		}
		if (mode.key === 'pinned') {
			return [{ kind: 'pinned' as const, label: 'Pinned messages', sub: 'pinned: true', icon: Pin }];
		}
		// before / after → handled by the date picker, no list items
		return [];
	});

	const isDateMode = $derived(mode.type === 'value' && (mode.key === 'before' || mode.key === 'after'));
	const showDropdown = $derived(
		open && dropdownOpen && !dismissed && (suggestions.length > 0 || isDateMode)
	);

	// Reset the keyboard cursor whenever the visible suggestion set changes.
	$effect(() => {
		void suggestions;
		void isDateMode;
		activeIndex = 0;
	});

	// Fresh server → wipe everything so stale results can't cross servers.
	let lastServerId = '';
	$effect(() => {
		if (serverId !== lastServerId) {
			lastServerId = serverId;
			resetAll();
		}
	});

	// Autofocus the input when the dialog opens.
	$effect(() => {
		if (open) {
			const t = setTimeout(() => inputEl?.focus(), 40);
			return () => clearTimeout(t);
		}
	});

	function resetAll() {
		chips = [];
		text = '';
		results = [];
		total = 0;
		hasSearched = false;
		dismissed = false;
	}

	function addChip(key: FilterKey, value: string, label: string) {
		// Single-value filters replace; `has` accumulates (deduped).
		if (key === 'has') {
			if (chips.some((c) => c.key === 'has' && c.value === value)) return;
		} else {
			chips = chips.filter((c) => c.key !== key);
		}
		chips = [...chips, { id: `${key}:${value}`, key, value, label }];
	}

	function removeChip(id: string) {
		chips = chips.filter((c) => c.id !== id);
		inputEl?.focus();
	}

	function stripTrailingToken() {
		text = text.replace(TOKEN_RE, '');
	}

	function pickFilter(key: FilterKey) {
		if (key === 'pinned') {
			addChip('pinned', 'true', 'pinned: true');
			text = text.replace(WORD_RE, '');
		} else {
			// Replace the trailing partial word with `key:` to enter value mode.
			text = text.replace(WORD_RE, (_m, w: string) => _m.slice(0, _m.length - w.length) + `${key}:`);
		}
		dismissed = false;
		inputEl?.focus();
	}

	function pickUser(key: 'from' | 'mentions', did: string, name: string) {
		addChip(key, did, `${key}: ${name}`);
		stripTrailingToken();
		inputEl?.focus();
	}

	function pickChannel(id: string, name: string) {
		addChip('in', id, `in: #${name}`);
		stripTrailingToken();
		inputEl?.focus();
	}

	function pickHas(value: string) {
		addChip('has', value, `has: ${value}`);
		stripTrailingToken();
		inputEl?.focus();
	}

	function pickPinned() {
		addChip('pinned', 'true', 'pinned: true');
		stripTrailingToken();
		inputEl?.focus();
	}

	function commitDate(key: 'before' | 'after', dateStr: string) {
		if (!dateStr) return;
		addChip(key, dateStr, `${key}: ${dateStr}`);
		stripTrailingToken();
		inputEl?.focus();
	}

	function pickSuggestion(item: SuggestItem) {
		switch (item.kind) {
			case 'filter':
				pickFilter(item.fkey!);
				break;
			case 'user':
				pickUser(mode.type === 'value' && mode.key === 'mentions' ? 'mentions' : 'from', item.did!, item.name ?? item.label);
				break;
			case 'channel':
				pickChannel(item.channelId!, item.name ?? item.label);
				break;
			case 'has':
				pickHas(item.hasValue!);
				break;
			case 'pinned':
				pickPinned();
				break;
		}
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (showDropdown && suggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				activeIndex = (activeIndex + 1) % suggestions.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				pickSuggestion(suggestions[activeIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				dismissed = true;
				return;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			void runSearch();
			return;
		}
		if (e.key === 'Backspace' && text.length === 0 && chips.length > 0) {
			chips = chips.slice(0, -1);
		}
	}

	function buildParams(offset: number) {
		const q = text.replace(TOKEN_RE, '').trim();
		const has: string[] = [];
		const params: Parameters<typeof searchMessages>[1] = { offset, limit: PAGE };
		if (q) params.q = q;
		for (const c of chips) {
			if (c.key === 'from') params.sender_id = c.value;
			else if (c.key === 'mentions') params.mentions = c.value;
			else if (c.key === 'in') params.channel_id = c.value;
			else if (c.key === 'has') has.push(c.value);
			else if (c.key === 'pinned') params.pinned = true;
			else if (c.key === 'before') params.until = `${c.value}T23:59:59`;
			else if (c.key === 'after') params.since = `${c.value}T00:00:00`;
		}
		if (has.length) params.has = has;
		return params;
	}

	const canSearch = $derived(chips.length > 0 || text.replace(TOKEN_RE, '').trim().length > 0);

	async function runSearch() {
		if (!canSearch || searching) return;
		dismissed = true;
		searching = true;
		hasSearched = true;
		try {
			const res = await searchMessages(serverId, buildParams(0));
			results = res.items;
			total = res.total;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Search failed');
			results = [];
			total = 0;
		} finally {
			searching = false;
		}
	}

	async function loadMore() {
		if (loadingMore || results.length >= total) return;
		loadingMore = true;
		try {
			const res = await searchMessages(serverId, buildParams(results.length));
			results = [...results, ...res.items];
			total = res.total;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load more results');
		} finally {
			loadingMore = false;
		}
	}

	function openResult(r: SearchMessage) {
		onClose();
		if (r.channel_id === currentChannelId) {
			onJump(r.id);
		} else {
			goto(
				`/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(r.channel_id)}?jump=${encodeURIComponent(r.id)}`
			);
		}
	}

	function formatTime(iso: string) {
		return new Date(iso).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function attachmentKinds(r: SearchMessage): { image: boolean; video: boolean; file: boolean } {
		const atts = (r.attachments ?? []) as { mime_type?: string }[];
		return {
			image: atts.some((a) => a.mime_type?.startsWith('image/')),
			video: atts.some((a) => a.mime_type?.startsWith('video/')),
			file: atts.length > 0
		};
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<!-- `overflow-visible`, not hidden: the filter autocomplete below is
	     absolutely positioned, so a clipping ancestor cut it off at the dialog
	     edge — and when its content was shorter than `max-h-72` it had no inner
	     scrollbar either, leaving the last option unreachable. The results list
	     keeps its own `overflow-y-auto`, so nothing else escapes the box. -->
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-0 overflow-visible p-0 sm:max-w-2xl">
		<Dialog.Header class="border-b border-border p-3 text-left">
			<Dialog.Title class="sr-only">Search messages</Dialog.Title>
			<!-- Token input + autocomplete -->
			<div
				class="relative"
				onfocusin={() => (dropdownOpen = true)}
				onfocusout={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dropdownOpen = false;
				}}
			>
				<div
					class="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring"
				>
					<Search class="h-4 w-4 shrink-0 text-muted-foreground" />
					{#each chips as chip (chip.id)}
						<span
							class="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
						>
							{chip.label}
							<button
								type="button"
								class="rounded-full text-primary/70 hover:text-primary"
								aria-label="Remove filter"
								onclick={() => removeChip(chip.id)}
							>
								<X class="h-3 w-3" />
							</button>
						</span>
					{/each}
					<input
						bind:this={inputEl}
						bind:value={text}
						oninput={() => (dismissed = false)}
						onkeydown={onInputKeydown}
						placeholder={chips.length ? 'Add filter or text…' : 'Search messages'}
						class="min-w-[8rem] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
						aria-label="Search messages"
						autocomplete="off"
						spellcheck="false"
					/>
				</div>

				{#if showDropdown}
					<div
						class="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
						role="listbox"
					>
						{#if mode.type === 'filters'}
							<p class="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
								Filters
							</p>
						{/if}
						{#if isDateMode}
							<div class="p-2">
								<label class="mb-1 block text-xs text-muted-foreground" for="search-date">
									{mode.key === 'before' ? 'Sent before' : 'Sent after'}
								</label>
								<input
									id="search-date"
									type="date"
									class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
									onchange={(e) => commitDate(mode.key as 'before' | 'after', e.currentTarget.value)}
								/>
							</div>
						{:else}
							{#each suggestions as item, i (item.label + i)}
								{@const Icon = item.icon}
								<button
									type="button"
									role="option"
									aria-selected={i === activeIndex}
									onmouseenter={() => (activeIndex = i)}
									onclick={() => pickSuggestion(item)}
									class="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm {i === activeIndex
										? 'bg-accent text-accent-foreground'
										: 'text-foreground'}"
								>
									{#if item.kind === 'user'}
										<Avatar.Root class="h-6 w-6 shrink-0">
											{#if item.avatar}<Avatar.Image src={item.avatar} alt="" />{/if}
											<Avatar.Fallback class="text-[10px]">{item.fallback}</Avatar.Fallback>
										</Avatar.Root>
									{:else if Icon}
										<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block truncate font-medium">{item.label}</span>
										{#if item.sub}
											<span class="block truncate text-[11px] text-muted-foreground">{item.sub}</span>
										{/if}
									</span>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
			<p class="mt-1.5 flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
				<CornerDownLeft class="h-3 w-3" /> Enter to search · filters: from, mentions, in, has, before, after, pinned
			</p>
		</Dialog.Header>

		<!-- Results -->
		<div class="min-h-0 flex-1 overflow-y-auto p-3">
			{#if searching}
				<div class="flex items-center justify-center py-12 text-muted-foreground">
					<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Searching…
				</div>
			{:else if !hasSearched}
				<div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
					<Search class="h-8 w-8 text-muted-foreground/40" />
					<p class="text-sm text-muted-foreground">
						Search messages across every channel you can read.
					</p>
					<p class="max-w-sm text-xs text-muted-foreground/80">
						Combine text with filters — e.g. <code class="text-foreground">from: alice has: image</code>
					</p>
				</div>
			{:else if results.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
					<Search class="h-8 w-8 text-muted-foreground/40" />
					<p class="text-sm font-medium text-foreground">No results found</p>
					<p class="text-xs text-muted-foreground">Try different keywords or fewer filters.</p>
				</div>
			{:else}
				<p class="mb-2 px-0.5 text-xs font-medium text-muted-foreground">
					{total}
					{total === 1 ? 'result' : 'results'}
				</p>
				<div class="space-y-1.5">
					{#each results as r (r.id)}
						{@const profile = resolveProfile(r.sender_id, r.sender_instance_url)}
						{@const kinds = attachmentKinds(r)}
						<button
							type="button"
							onclick={() => openResult(r)}
							class="flex w-full gap-3 rounded-md border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
						>
							<Avatar.Root class="h-8 w-8 shrink-0">
								{#if profile.avatar_url}<Avatar.Image src={proxied(profile.avatar_url)} alt="" />{/if}
								<Avatar.Fallback class="text-xs">
									{displayName(profile, r.sender_id).slice(0, 2).toUpperCase()}
								</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
									<span class="truncate text-sm font-medium text-foreground">
										{displayName(profile, r.sender_id)}
									</span>
									{#if r.channel_name}
										<span class="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
											<Hash class="h-3 w-3" />{r.channel_name}
										</span>
									{/if}
									<span class="text-[11px] text-muted-foreground">{formatTime(r.created_at)}</span>
								</div>
								{#if r.content}
									<p class="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
										{r.content}
									</p>
								{/if}
								{#if kinds.file || (r.embeds?.length ?? 0) > 0}
									<div class="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
										{#if kinds.image}<span class="inline-flex items-center gap-0.5"><ImageIcon class="h-3 w-3" /> image</span>{/if}
										{#if kinds.video}<span class="inline-flex items-center gap-0.5"><Film class="h-3 w-3" /> video</span>{/if}
										{#if kinds.file && !kinds.image && !kinds.video}<span class="inline-flex items-center gap-0.5"><FileText class="h-3 w-3" /> file</span>{/if}
										{#if (r.embeds?.length ?? 0) > 0}<span class="inline-flex items-center gap-0.5"><LinkIcon class="h-3 w-3" /> embed</span>{/if}
									</div>
								{/if}
							</div>
						</button>
					{/each}
				</div>

				{#if results.length < total}
					<div class="mt-3 flex justify-center">
						<button
							type="button"
							onclick={loadMore}
							disabled={loadingMore}
							class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
						>
							{#if loadingMore}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
							Load more ({results.length}/{total})
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
