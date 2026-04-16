<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Reply, Pencil, Trash2, SmilePlus, FileIcon, Pin, PinOff, X, Check, Crown, Eye, EyeOff, Ban } from '@lucide/svelte';
	import EmojiPicker from './emoji-picker.svelte';
	import ImageLightbox from './image-lightbox.svelte';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getRoles } from '$lib/stores/roles.svelte';
	import { resolveEmojis } from '$lib/stores/emojis.svelte';
	import { getMessages } from '$lib/stores/messages.svelte';
	import { getRelations } from '$lib/stores/relations.svelte';
	import { renderEmojis, isStickerOnly } from '$lib/utils/emoji-render';
	import { proxied } from '$lib/utils/proxy';
	import ProfileHoverCard from './profile-hover-card.svelte';
	import SafeMedia from './safe-media.svelte';
	import SafeLink from './safe-link.svelte';

	const {
		message,
		isOwn,
		serverOwnerId,
		canModerate = false,
		grouped = false,
		onReply,
		onEdit,
		onDelete,
		onReact,
		onClearEmbeds,
		onTogglePin
	}: {
		message: {
			id: string;
			sender_id: string;
			sender_instance_url?: string;
			content: string;
			created_at: string;
			edited_at?: string;
			reply_to?: string[] | string;
			pinned?: boolean;
			deleted?: boolean;
			deleted_at?: string;
			deleted_by?: string;
			attachments?: { url: string; filename: string; mime_type: string; size: number; width?: number; height?: number }[];
			embeds?: { title?: string; description?: string; url?: string; thumbnail_url?: string; site_name?: string; embed_url?: string }[];
			reactions?: { value: string; count: number; me: boolean; kind?: string; image_url?: string }[];
		};
		isOwn: boolean;
		serverOwnerId?: string | null;
		canModerate?: boolean;
		/** True when this message should be grouped under the previous message
		 *  (same sender within a short window). Avatar + name + header timestamp
		 *  are hidden; a compact timestamp goes in the left gutter instead. */
		grouped?: boolean;
		onReply: (id: string) => void;
		onEdit?: (id: string, newContent: string) => void;
		onDelete?: (id: string) => void;
		onReact?: (messageId: string, emoji: string) => void;
		onClearEmbeds?: (id: string) => void;
		onTogglePin?: (id: string, nextPinned: boolean) => void;
	} = $props();

	const senderIsOwner = $derived(!!serverOwnerId && message.sender_id === serverOwnerId);
	const canDelete = $derived(isOwn || canModerate);

	const profile = $derived(resolveProfile(message.sender_id, message.sender_instance_url));
	const senderAvatar = $derived(proxied(profile.avatar_url));

	const memberStore = getMembers();
	const roleStore = getRoles();

	// Prefer server nickname → profile display_name → DID prefix
	const senderName = $derived.by(() => {
		const member = memberStore.list.find((m) => m.user_id === message.sender_id);
		const nickname = (member as any)?.nickname as string | undefined;
		return nickname || displayName(profile, message.sender_id);
	});
	const senderColor = $derived.by(() => {
		const member = memberStore.list.find((m) => m.user_id === message.sender_id);
		if (!member?.role_ids?.length) return null;
		const ids = member.role_ids.map((r) => String(r));
		// roles store is sorted highest-position first
		const colored = roleStore.list.find((r) => ids.includes(r.id) && r.color);
		return colored?.color ?? null;
	});

	const time = $derived(
		new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	);
	// Full timestamp for hover tooltips on the gutter timestamp shown in
	// grouped messages — the short "HH:MM" is visible, full context on hover.
	const fullTime = $derived(new Date(message.created_at).toLocaleString());

	// Inline emoji / sticker rendering — resolve against the SENDER's syr emojis
	const senderEmojis = $derived(resolveEmojis(message.sender_id, message.sender_instance_url));
	const renderedContent = $derived(renderEmojis(message.content, senderEmojis.map));
	const stickerOnly = $derived(isStickerOnly(renderedContent));

	// Resolve parent messages so we can render a preview for each.
	// Server stores `reply_to` as an array; accept legacy single-string too.
	const messagesStore = getMessages();
	const replyIds = $derived<string[]>(
		Array.isArray(message.reply_to)
			? message.reply_to
			: message.reply_to
				? [message.reply_to]
				: []
	);
	const parentMessages = $derived(
		replyIds.map((id) => ({ id, msg: messagesStore.find(id) }))
	);

	function parentName(senderId: string, senderInstanceUrl?: string): string {
		const member = memberStore.list.find((m) => m.user_id === senderId);
		const nickname = (member as any)?.nickname as string | undefined;
		const profile = resolveProfile(senderId, senderInstanceUrl);
		return nickname || displayName(profile, senderId);
	}

	function scrollToParent(id: string) {
		const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
		if (el && el instanceof HTMLElement) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
			setTimeout(() => {
				el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
			}, 1500);
		}
	}

	// Image lightbox
	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);
	const imageAttachments = $derived(
		(message.attachments ?? []).filter(
			(a) => a.mime_type.startsWith('image/') || a.mime_type.startsWith('video/')
		)
	);
	function openLightbox(att: { url: string }) {
		const idx = imageAttachments.findIndex((a) => a.url === att.url);
		lightboxIndex = idx >= 0 ? idx : 0;
		lightboxOpen = true;
	}

	let showActions = $state(false);
	let showEmojiPicker = $state(false);
	let editing = $state(false);
	let editContent = $state('');
	let confirmDelete = $state(false);

	function startEdit() {
		editContent = message.content;
		editing = true;
	}

	function cancelEdit() {
		editing = false;
		editContent = '';
	}

	function saveEdit() {
		if (editContent.trim() && editContent !== message.content) {
			onEdit?.(message.id, editContent.trim());
		}
		editing = false;
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
		if (e.key === 'Escape') cancelEdit();
	}

	// ── Block / ignore rendering ──
	// Block: replace the row with a minimal "Blocked message" placeholder + eye
	// toggle to reveal the original content (with a persistent banner on top).
	// Ignore: render the full message muted with attachments/embeds collapsed
	// behind a "+N attachment" pill. Both are purely render-time concerns —
	// the raw row stays in the store.
	const relations = getRelations();
	const senderBlocked = $derived(relations.isBlocked(message.sender_id));
	const senderIgnored = $derived(relations.isIgnored(message.sender_id));
	let revealedBlocked = $state(false);
	let expandedIgnored = $state(false);
</script>

<div
	data-message-id={message.id}
	class="group relative px-4 transition-[box-shadow] hover:bg-accent/30 {grouped ? 'py-0.5 mt-0.5' : 'py-1 mt-2'}"
	onmouseenter={() => (showActions = true)}
	onmouseleave={() => { showActions = false; showEmojiPicker = false; confirmDelete = false; }}
>
	{#if replyIds.length > 0}
		<div class="ml-10 mb-0.5 flex flex-col gap-0.5">
			{#each parentMessages as { id, msg } (id)}
				<button
					type="button"
					onclick={() => scrollToParent(id)}
					class="flex max-w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
				>
					<svg class="h-3 w-3 shrink-0 -translate-y-0.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path
							d="M2 10 V6 C2 4 3 3 5 3 H10"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					{#if msg}
						<span class="truncate font-medium">
							{parentName(msg.sender_id, msg.sender_instance_url)}
						</span>
						<span class="shrink-0">·</span>
						<span class="truncate">
							{msg.content || (msg.attachments?.length ? '[attachment]' : '')}
						</span>
						{#if msg.deleted}
							<span
								class="ml-1 shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-destructive"
								title="This message has been removed"
							>
								removed
							</span>
						{/if}
					{:else}
						<!--
							Parent target not in the local store. Two causes:
							  a) Message already deleted + caller lacks VIEW_REMOVED_MESSAGES
								 → non-privileged tombstone (Block 13 default public view).
							  b) Parent hasn't been paginated-in yet (rare — older than 50 msgs).
							Treat both as "message deleted" from the reader's POV. Harmless
							for case (b) because the moment it paginates in, the reactive
							lookup succeeds and the real preview replaces this.
						-->
						<span class="italic">Message deleted</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
	{#if senderBlocked && !revealedBlocked}
		<!-- Blocked placeholder: replace the entire row with a single muted line
			and an eye toggle. Per-message reveal is remembered locally only —
			next mount reverts to hidden. Hover actions are suppressed (nothing
			to react to / reply to from a hidden row). -->
		<div class="flex items-center gap-2 rounded px-2 py-0.5 text-xs text-muted-foreground">
			<Ban class="h-3 w-3 shrink-0" />
			<span class="italic">Blocked message</span>
			<span class="truncate font-mono text-[10px] opacity-70" title={message.sender_id}>
				{message.sender_id.slice(0, 20)}…
			</span>
			<button
				type="button"
				onclick={() => (revealedBlocked = true)}
				class="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground"
				title="Reveal blocked message"
			>
				<Eye class="h-3.5 w-3.5" />
			</button>
		</div>
	{:else}
	{#if senderBlocked && revealedBlocked}
		<div class="ml-14 mb-0.5 flex items-center gap-1.5 text-[10px] text-destructive/80">
			<Ban class="h-3 w-3" />
			<span>Revealed from a blocked user</span>
			<button
				type="button"
				onclick={() => (revealedBlocked = false)}
				class="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
				title="Hide again"
			>
				<EyeOff class="h-3 w-3" />
				Hide
			</button>
		</div>
	{/if}
	<div class="flex gap-3 {senderIgnored && !expandedIgnored ? 'opacity-60' : ''}">
		{#if grouped}
			<!-- Grouped: timestamp in the avatar gutter, visible on row hover.
				 Width matches the avatar so the content column stays flush with
				 non-grouped rows in the same group. `whitespace-nowrap` ensures
				 the time never wraps regardless of format (12h "04:07 PM" or
				 24h "16:07"); any sliver of overflow is absorbed by the
				 surrounding gap + row padding. -->
			<div
				class="mt-0.5 flex h-5 w-11 shrink-0 items-start justify-center whitespace-nowrap pt-[2px] text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
				title={fullTime}
			>
				{time}
			</div>
		{:else}
			<ProfileHoverCard did={message.sender_id} instanceUrl={message.sender_instance_url}>
				<div class="mt-0.5 shrink-0">
					<Avatar.Root class="h-11 w-11">
						{#if senderAvatar}
							<Avatar.Image src={senderAvatar} alt={senderName} />
						{/if}
						<Avatar.Fallback class="text-xs">
							{senderName.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
				</div>
			</ProfileHoverCard>
		{/if}

	<div class="min-w-0 flex-1">
		{#if !grouped}
			<div class="flex items-baseline gap-2">
				<ProfileHoverCard did={message.sender_id} instanceUrl={message.sender_instance_url}>
					<span
						class="flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
						style={senderColor ? `color: ${senderColor}` : ''}
					>
						{senderName}
						{#if senderIsOwner}
							<Crown class="h-3.5 w-3.5 text-amber-500" />
						{/if}
					</span>
				</ProfileHoverCard>
				<span class="text-[11px] text-muted-foreground" title={fullTime}>{time}</span>
				{#if message.edited_at}
					<span class="text-[10px] text-muted-foreground">(edited)</span>
				{/if}
				{#if message.pinned}
					<Pin class="h-3 w-3 text-muted-foreground" />
				{/if}
			</div>
		{:else if message.edited_at || message.pinned}
			<!-- Tiny inline markers on grouped rows, only if non-default state. -->
			<div class="flex items-center gap-1 text-[10px] text-muted-foreground">
				{#if message.edited_at}<span>(edited)</span>{/if}
				{#if message.pinned}<Pin class="h-3 w-3" />{/if}
			</div>
		{/if}

		<!-- Deleted banner — only visible to viewers who can see removed messages
			 AND when the row still carries content (masking happened server-side
			 otherwise). Keeps context that a removed message is displayed. -->
		{#if message.deleted && message.content}
			{@const deleterProfile = resolveProfile(message.deleted_by ?? '', undefined)}
			<p class="mt-1 text-[10px] italic text-destructive/80">
				Removed by {displayName(deleterProfile, message.deleted_by ?? '')}
				{#if message.deleted_at} · {new Date(message.deleted_at).toLocaleString()}{/if}
			</p>
		{/if}

		<!-- Content or edit mode -->
		{#if message.deleted && !message.content}
			{@const deleterProfile = resolveProfile(message.deleted_by ?? '', undefined)}
			<p class="mt-1 text-sm italic text-muted-foreground">
				Message removed
				{#if message.deleted_by}
					by <span class="font-medium">{displayName(deleterProfile, message.deleted_by)}</span>
				{/if}
				{#if message.deleted_at} · {new Date(message.deleted_at).toLocaleString()}{/if}
			</p>
		{:else if editing}
			<div class="mt-1 space-y-1">
				<textarea
					bind:value={editContent}
					onkeydown={handleEditKeydown}
					class="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					rows={2}
				></textarea>
				<div class="flex items-center gap-1 text-xs text-muted-foreground">
					<span>escape to</span>
					<button onclick={cancelEdit} class="text-primary hover:underline">cancel</button>
					<span>&#x2022; enter to</span>
					<button onclick={saveEdit} class="text-primary hover:underline">save</button>
				</div>
			</div>
		{:else if renderedContent.length > 0}
			<p
				class="whitespace-pre-wrap {stickerOnly
					? 'flex flex-wrap gap-1'
					: 'text-sm text-foreground/90'}"
			>
				{#each renderedContent as token, i (i)}
					{#if token.kind === 'text'}
						<span>{token.value}</span>
					{:else if token.kind === 'link'}
						<SafeLink href={token.url} class="text-primary hover:underline">{token.url}</SafeLink>
					{:else if token.kind === 'emoji'}
						<img
							src={proxied(token.entry.url)}
							alt={':' + token.shortcode + ':'}
							title={':' + token.shortcode + ':'}
							class="inline-block h-[1.3em] w-[1.3em] align-[-0.2em] object-contain"
						/>
					{:else if token.kind === 'sticker'}
						<img
							src={proxied(token.entry.url)}
							alt={'::' + token.shortcode + '::'}
							title={'::' + token.shortcode + '::'}
							class="max-h-32 w-auto object-contain"
						/>
					{:else}
						<span class="text-muted-foreground">
							{token.sticker ? '::' : ':'}{token.shortcode}{token.sticker ? '::' : ':'}
						</span>
					{/if}
				{/each}
			</p>
		{/if}

		{#if !message.deleted || message.content}
		{@const attachmentsCount = (message.attachments?.length ?? 0) + (message.embeds?.filter((e) => e.title || e.description).length ?? 0)}
		{#if senderIgnored && !expandedIgnored && attachmentsCount > 0}
			<!-- Ignored: collapse attachments + embeds behind a single pill so the
				row stays compact. Expanded state is per-message + local only. -->
			<button
				type="button"
				onclick={() => (expandedIgnored = true)}
				class="mt-1 inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
				title="Show attachments"
			>
				<Eye class="h-3 w-3" />
				+{attachmentsCount} hidden attachment{attachmentsCount === 1 ? '' : 's'}
			</button>
		{:else}
		<!-- Attachments -->
		{#if message.attachments?.length}
			<div class="mt-1 flex flex-wrap gap-2">
				{#each message.attachments as attachment}
					{#if attachment.mime_type.startsWith('image/')}
						<div
							role="button"
							tabindex="0"
							onclick={() => openLightbox(attachment)}
							onkeydown={(e) => { if (e.key === 'Enter') openLightbox(attachment); }}
							class="block max-w-sm cursor-zoom-in overflow-hidden rounded-md border border-border"
						>
							<SafeMedia
								src={attachment.url}
								alt={attachment.filename}
								as="img"
								class="block max-h-[300px]"
							/>
						</div>
					{:else if attachment.mime_type.startsWith('video/')}
						<div
							role="button"
							tabindex="0"
							onclick={() => openLightbox(attachment)}
							onkeydown={(e) => { if (e.key === 'Enter') openLightbox(attachment); }}
							class="block max-w-sm cursor-zoom-in overflow-hidden rounded-md border border-border bg-black"
						>
							<SafeMedia src={attachment.url} as="video" class="block max-h-[300px]" />
						</div>
					{:else}
						<a
							href={attachment.url}
							target="_blank"
							rel="noopener"
							class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
						>
							<FileIcon class="h-4 w-4 text-muted-foreground" />
							<span class="truncate text-foreground">{attachment.filename}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{(attachment.size / 1024).toFixed(0)} KB
							</span>
						</a>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Embeds -->
		{#if message.embeds?.length}
			<div class="mt-1 space-y-1">
				{#each message.embeds as embed}
					{#if embed.title || embed.description}
						<div class="relative max-w-md rounded-md border-l-4 border-primary bg-muted/30 p-3">
							{#if isOwn && onClearEmbeds}
								<button
									onclick={() => onClearEmbeds?.(message.id)}
									class="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
									title="Remove embed"
								>
									<X class="h-3.5 w-3.5" />
								</button>
							{/if}
							{#if embed.site_name}
								<div class="text-[11px] text-muted-foreground">{embed.site_name}</div>
							{/if}
							{#if embed.title}
								{#if embed.url}
									<SafeLink href={embed.url} class="text-sm font-medium text-primary hover:underline">
										{embed.title}
									</SafeLink>
								{:else}
									<span class="text-sm font-medium text-foreground">{embed.title}</span>
								{/if}
							{/if}
							{#if embed.description}
								<p class="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{embed.description}</p>
							{/if}
							{#if embed.embed_url}
								<div class="mt-2 aspect-video max-w-md overflow-hidden rounded">
									<iframe
										src={embed.embed_url}
										title={embed.title ?? 'Video'}
										class="h-full w-full"
										frameborder="0"
										allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
										allowfullscreen
									></iframe>
								</div>
							{:else if embed.thumbnail_url}
								<img src={proxied(embed.thumbnail_url)} alt="" class="mt-2 max-h-40 rounded" />
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{/if}

		<!-- Reactions -->
		{#if message.reactions?.length}
			<div class="mt-1 flex flex-wrap gap-1">
				{#each message.reactions as reaction}
					<button
						onclick={() => onReact?.(message.id, reaction.value)}
						class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors
							{reaction.me
							? 'border-primary/50 bg-primary/10 text-primary'
							: 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'}"
					>
						{#if reaction.kind === 'custom_emoji' && reaction.image_url}
							<img src={proxied(reaction.image_url)} alt={reaction.value} class="h-4 w-4 object-contain" />
						{:else}
							<span>{reaction.value}</span>
						{/if}
						<span>{reaction.count}</span>
					</button>
				{/each}
			</div>
		{/if}
		{/if}
	</div>

	<!-- Hover actions — hidden once a message is removed (can't react to or re-delete) -->
	{#if showActions && !editing && !message.deleted}
		<div class="absolute -top-3 right-4 flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm">
			<button onclick={() => (showEmojiPicker = !showEmojiPicker)} class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="React">
				<SmilePlus class="h-4 w-4" />
			</button>
			<button onclick={() => onReply(message.id)} class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Reply">
				<Reply class="h-4 w-4" />
			</button>
			{#if isOwn && onEdit}
				<button onclick={startEdit} class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit">
					<Pencil class="h-4 w-4" />
				</button>
			{/if}
			{#if canModerate && onTogglePin}
				<button
					onclick={() => onTogglePin?.(message.id, !message.pinned)}
					class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					title={message.pinned ? 'Unpin' : 'Pin'}
				>
					{#if message.pinned}
						<PinOff class="h-4 w-4" />
					{:else}
						<Pin class="h-4 w-4" />
					{/if}
				</button>
			{/if}
			{#if canDelete && onDelete}
				{#if confirmDelete}
					<button onclick={() => { onDelete?.(message.id); confirmDelete = false; }} class="rounded p-1 text-destructive hover:bg-destructive/20" title="Confirm delete">
						<Check class="h-4 w-4" />
					</button>
					<button onclick={() => (confirmDelete = false)} class="rounded p-1 text-muted-foreground hover:bg-accent" title="Cancel">
						<X class="h-4 w-4" />
					</button>
				{:else}
					<button onclick={() => (confirmDelete = true)} class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive" title="Delete">
						<Trash2 class="h-4 w-4" />
					</button>
				{/if}
			{/if}
		</div>

		{#if showEmojiPicker}
			<div class="absolute -top-3 right-4 z-50 mt-8">
				<EmojiPicker
					onSelect={(emoji) => { onReact?.(message.id, emoji); showEmojiPicker = false; }}
					onClose={() => (showEmojiPicker = false)}
				/>
			</div>
		{/if}
	{/if}
	</div>
	{/if}
</div>

{#if lightboxOpen && imageAttachments.length > 0}
	<ImageLightbox
		open={true}
		items={imageAttachments}
		startIndex={lightboxIndex}
		onClose={() => (lightboxOpen = false)}
	/>
{/if}
