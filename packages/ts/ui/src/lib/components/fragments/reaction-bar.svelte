<script lang="ts">
	import { Popover } from 'bits-ui';
	import { SmilePlus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { resolveEmojis } from '@syren/app-core/stores/emojis.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { groupReactions, type ReactionGroup, type PublicReaction } from '@syren/app-core/upload/interactions';
	import type { ReactionCreate, ReactionParentType } from '@syren/types';
	import EmojiPicker from './emoji-picker.svelte';

	/**
	 * Presentational reaction bar (P8). The parent thread fetches + owns all
	 * reaction data (by-target ∪ follow-graph fan-out) and passes this target's
	 * flat list in; the bar only groups, renders, and reports toggles. Unicode +
	 * custom-emoji; custom resolves its image through the viewer's own emoji set.
	 */
	const {
		reactions,
		parentType,
		parentDid,
		parentId,
		onToggle,
		canReact,
		class: className = ''
	}: {
		reactions: PublicReaction[];
		parentType: ReactionParentType;
		parentDid: string;
		parentId: string;
		onToggle: (body: ReactionCreate) => void;
		canReact: boolean;
		class?: string;
	} = $props();

	const auth = getAuth();
	const myDid = $derived(auth.identity?.did);
	const myInstance = $derived(auth.identity?.syr_instance_url);

	let pickerOpen = $state(false);

	const groups = $derived(groupReactions(reactions, myDid));
	const myEmojis = $derived(myDid ? resolveEmojis(myDid, myInstance).entries : []);

	function toggleGroup(g: ReactionGroup) {
		if (!canReact) return;
		onToggle({
			parent_type: parentType,
			parent_did: parentDid,
			parent_id: parentId,
			kind: g.kind,
			value: g.value,
			image_url: g.image_url ?? undefined
		});
	}

	function onPick(token: string) {
		pickerOpen = false;
		if (!canReact) return;
		// Raw unicode glyph.
		if (!token.startsWith(':')) {
			onToggle({
				parent_type: parentType,
				parent_did: parentDid,
				parent_id: parentId,
				kind: 'unicode',
				value: token
			});
			return;
		}
		// Custom emoji / sticker token → resolve to its hosted image.
		const code = token.replace(/^:+|:+$/g, '');
		const entry = myEmojis.find((e) => e.shortcode === code);
		if (!entry) {
			toast.error('Emoji not found on your instance');
			return;
		}
		onToggle({
			parent_type: parentType,
			parent_did: parentDid,
			parent_id: parentId,
			kind: 'custom_emoji',
			value: code,
			image_url: entry.url
		});
	}
</script>

<div class="flex flex-wrap items-center gap-1 {className}">
	{#each groups as g (g.key)}
		<button
			type="button"
			disabled={!canReact}
			onclick={() => toggleGroup(g)}
			class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60 {g.reacted
				? 'border-primary/50 bg-primary/10 text-foreground'
				: 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'}"
			title="{g.count} reaction{g.count === 1 ? '' : 's'}"
		>
			{#if g.kind === 'unicode'}
				<span class="text-sm leading-none">{g.value}</span>
			{:else if g.image_url}
				<img src={proxied(g.image_url)} alt={g.value} class="h-4 w-4 object-contain" />
			{:else}
				<span>:{g.value}:</span>
			{/if}
			<span class="tabular-nums">{g.count}</span>
		</button>
	{/each}

	{#if canReact}
		<Popover.Root bind:open={pickerOpen}>
			<Popover.Trigger
				class="inline-flex h-6 items-center rounded-full border border-border bg-muted/40 px-1.5 text-muted-foreground hover:bg-muted"
				title="Add reaction"
			>
				<SmilePlus class="h-3.5 w-3.5" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content side="top" sideOffset={6} class="z-50">
					<EmojiPicker onSelect={onPick} onClose={() => (pickerOpen = false)} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	{/if}
</div>
