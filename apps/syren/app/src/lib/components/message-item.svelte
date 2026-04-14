<script lang="ts">
	import * as Avatar from '@syren/ui/avatar';
	import { Reply, Pencil, Trash2, SmilePlus, FileIcon, Pin, PinOff, X, Check, Crown } from '@lucide/svelte';
	import EmojiPicker from './emoji-picker.svelte';
	import ImageLightbox from './image-lightbox.svelte';
	import { resolveProfile, displayName } from '$lib/stores/profiles.svelte';
	import { getMembers } from '$lib/stores/members.svelte';
	import { getRoles } from '$lib/stores/roles.svelte';
	import { resolveEmojis } from '$lib/stores/emojis.svelte';
	import { getMessages } from '$lib/stores/messages.svelte';
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
			attachments?: { url: string; filename: string; mime_type: string; size: number; width?: number; height?: number }[];
			embeds?: { title?: string; description?: string; url?: string; thumbnail_url?: string; site_name?: string; embed_url?: string }[];
			reactions?: { value: string; count: number; me: boolean; kind?: string; image_url?: string }[];
		};
		isOwn: boolean;
		serverOwnerId?: string | null;
		canModerate?: boolean;
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
</script>

<div
	data-message-id={message.id}
	class="group relative px-4 py-1 transition-[box-shadow] hover:bg-accent/30"
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
					{:else}
						<span class="italic">Replying to message…</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
	<div class="flex gap-3">
		<ProfileHoverCard did={message.sender_id} instanceUrl={message.sender_instance_url}>
			<div class="mt-0.5 shrink-0">
				<Avatar.Root class="h-8 w-8">
					{#if senderAvatar}
						<Avatar.Image src={senderAvatar} alt={senderName} />
					{/if}
					<Avatar.Fallback class="text-xs">
						{senderName.slice(0, 2).toUpperCase()}
					</Avatar.Fallback>
				</Avatar.Root>
			</div>
		</ProfileHoverCard>

	<div class="min-w-0 flex-1">
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
			<span class="text-[11px] text-muted-foreground">{time}</span>
			{#if message.edited_at}
				<span class="text-[10px] text-muted-foreground">(edited)</span>
			{/if}
			{#if message.pinned}
				<Pin class="h-3 w-3 text-muted-foreground" />
			{/if}
		</div>

		<!-- Content or edit mode -->
		{#if editing}
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
	</div>

	<!-- Hover actions -->
	{#if showActions && !editing}
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
</div>

{#if lightboxOpen && imageAttachments.length > 0}
	<ImageLightbox
		open={true}
		items={imageAttachments}
		startIndex={lightboxIndex}
		onClose={() => (lightboxOpen = false)}
	/>
{/if}
