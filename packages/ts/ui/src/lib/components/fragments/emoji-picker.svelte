<script lang="ts">
	import { Search } from '@lucide/svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { resolveEmojis, type EmojiEntry } from '@syren/app-core/stores/emojis.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const {
		onSelect,
		onClose
	}: {
		/**
		 * `emoji` is either a raw unicode glyph, a `:shortcode:` (custom),
		 * or `::shortcode::` (sticker). The host inserts it at the textarea
		 * cursor; the renderer resolves it to an image on the other side.
		 */
		onSelect: (emoji: string) => void;
		onClose: () => void;
	} = $props();

	type Tab = 'unicode' | 'custom';
	let tab = $state<Tab>('unicode');
	let searchQuery = $state('');

	const auth = getAuth();
	const myDid = $derived(auth.identity?.did ?? '');
	const myInstance = $derived(auth.identity?.syr_instance_url);
	const customBundle = $derived<{
		entries: EmojiEntry[];
		loading: boolean;
		error?: boolean;
	}>(
		myDid
			? resolveEmojis(myDid, myInstance)
			: { entries: [] as EmojiEntry[], loading: false }
	);

	// Common emoji categories with unicode emojis
	const categories = [
		{
			name: 'Smileys',
			emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐']
		},
		{
			name: 'Gestures',
			emojis: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🤝', '🙏']
		},
		{
			name: 'Hearts',
			emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💕', '💞', '💓', '💗', '💖', '💘', '💝']
		},
		{
			name: 'Objects',
			emojis: ['🔥', '⭐', '✨', '💫', '🎉', '🎊', '🏆', '🎯', '💡', '📌', '📎', '🔗', '🔔', '🎵', '🎶', '🎤', '🎧', '🎮', '🎲', '🧩']
		},
		{
			name: 'Reactions',
			emojis: ['👀', '💀', '☠️', '💩', '🤡', '👻', '👽', '🤖', '😈', '👹', '💯', '‼️', '❓', '❗', '✅', '❌', '⭕', '🚫', '➡️', '⬆️']
		}
	];

	const filteredUnicode = $derived(
		searchQuery
			? categories
					.map((c) => ({ ...c, emojis: c.emojis.filter((e) => e.includes(searchQuery)) }))
					.filter((c) => c.emojis.length > 0)
			: categories
	);

	const filteredCustom = $derived<EmojiEntry[]>(
		(() => {
			const q = searchQuery.trim().toLowerCase();
			const list = customBundle.entries ?? [];
			if (!q) return list;
			return list.filter((e) => e.shortcode.toLowerCase().includes(q));
		})()
	);

	function pickUnicode(emoji: string) {
		onSelect(emoji);
		onClose();
	}

	function pickCustom(entry: EmojiEntry) {
		const token = entry.is_sticker ? `::${entry.shortcode}::` : `:${entry.shortcode}:`;
		onSelect(token);
		onClose();
	}
</script>

<div class="w-80 rounded-lg border border-border bg-card shadow-lg">
	<!-- Tabs -->
	<div class="flex border-b border-border">
		<button
			class="flex-1 px-3 py-1.5 text-xs font-medium {tab === 'unicode'
				? 'border-b-2 border-primary text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'unicode')}
		>
			Unicode
		</button>
		<button
			class="flex-1 px-3 py-1.5 text-xs font-medium {tab === 'custom'
				? 'border-b-2 border-primary text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'custom')}
		>
			Custom
			{#if customBundle.entries?.length}
				<span class="ml-1 text-[10px] text-muted-foreground">({customBundle.entries.length})</span>
			{/if}
		</button>
	</div>

	<!-- Search -->
	<div class="border-b border-border p-2">
		<div class="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
			<Search class="h-4 w-4 text-muted-foreground" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder={tab === 'custom' ? 'Search shortcodes...' : 'Search emoji...'}
				class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
			/>
		</div>
	</div>

	<!-- Grid -->
	<div class="max-h-64 overflow-y-auto p-2">
		{#if tab === 'unicode'}
			{#each filteredUnicode as category}
				<div class="mb-2">
					<div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{category.name}
					</div>
					<div class="grid grid-cols-8 gap-0.5">
						{#each category.emojis as emoji}
							<button
								onclick={() => pickUnicode(emoji)}
								class="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-accent"
							>
								{emoji}
							</button>
						{/each}
					</div>
				</div>
			{/each}
			{#if filteredUnicode.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No emoji found</p>
			{/if}
		{:else}
			{#if customBundle.loading}
				<p class="py-8 text-center text-xs text-muted-foreground">Loading your emojis...</p>
			{:else if customBundle.error}
				<p class="py-8 text-center text-xs text-destructive">
					Couldn't reach your syr instance.
				</p>
			{:else if filteredCustom.length === 0}
				<p class="py-8 text-center text-xs text-muted-foreground">
					{searchQuery
						? 'No shortcodes match'
						: 'No custom emojis on your syr instance. Add some there to see them here.'}
				</p>
			{:else}
				<div class="grid grid-cols-8 gap-0.5">
					{#each filteredCustom as entry (entry.shortcode)}
						<button
							onclick={() => pickCustom(entry)}
							class="group relative flex h-8 w-8 items-center justify-center rounded hover:bg-accent"
							title={(entry.is_sticker ? '::' : ':') + entry.shortcode + (entry.is_sticker ? '::' : ':')}
						>
							<img src={proxied(entry.url)} alt={entry.shortcode} class="h-6 w-6 object-contain" />
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
