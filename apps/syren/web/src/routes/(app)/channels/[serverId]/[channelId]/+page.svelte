<script lang="ts">
	import { Hash, Users, Pin, ScrollText, Eye, EyeOff } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import MessageItem from '$lib/components/message-item.svelte';
	import MessageInput from '$lib/components/message-input.svelte';
	import MemberList from '$lib/components/member-list.svelte';
	import PinsPanel from '$lib/components/pins-panel.svelte';
	import VoiceRoomView from '$lib/components/voice-room-view.svelte';
	import { Permissions } from '@syren/types';
	import { api } from '$lib/api';
	import { subscribeChannels } from '$lib/stores/ws.svelte';
	import { setCurrentChannel, getMessages, addMessage } from '$lib/stores/messages.svelte';
	import { setTypingChannel, getTyping } from '$lib/stores/typing.svelte';
	import { getProfile, displayName } from '$lib/stores/profiles.svelte';
	import { setActiveChannelForUnread } from '$lib/stores/unread.svelte';
	import { getServerState } from '$lib/stores/servers.svelte';
	import { getPerms } from '$lib/stores/perms.svelte';
	import { page } from '$app/state';
	import { getAuth } from '$lib/stores/auth.svelte';

	const auth = getAuth();
	const channelId = $derived(page.params.channelId ?? '');
	const serverId = $derived(page.params.serverId ?? '');
	const serverState = getServerState();
	const perms = getPerms();

	// Derive channel info from the store
	const channelInfo = $derived(serverState.channels.find((c) => c.id === channelId));
	const channelName = $derived(channelInfo?.name || '');
	const channelTopic = $derived(channelInfo?.topic || '');
	const isVoice = $derived(channelInfo?.type === 'voice');
	const canSendHere = $derived(perms.canInChannel(channelId, Permissions.SEND_MESSAGES));

	let showMembers = $state(true);
	let showPins = $state(false);
	/**
	 * Channel-scoped "show removed messages" toggle. Ephemeral — resets on
	 * channel switch. Only meaningful for users with VIEW_REMOVED_MESSAGES;
	 * the toggle button is hidden otherwise. When false, deleted messages
	 * are filtered from the timeline render (and never entered the local
	 * store for non-priv users in the first place).
	 */
	let showRemoved = $state(false);
	const MAX_REPLIES = 5;
	let replyTo = $state<{ id: string; content: string }[]>([]);
	let messagesContainer: HTMLDivElement | undefined = $state();
	let messagesInner: HTMLDivElement | undefined = $state();
	let loadingOlder = $state(false);
	let hasMoreMessages = $state(true);
	/**
	 * Whether the view is pinned to the newest message. Flips to `false` when
	 * the user scrolls up; back to `true` when they scroll within ~60 px of
	 * the bottom. Used by the ResizeObserver below to decide whether a
	 * height-change (images decoding, reactions landing, ...) should re-pin
	 * the scroll to the bottom.
	 */
	let stickToBottom = $state(true);
	const STICK_SLOP_PX = 60;

	const messageStore = getMessages();
	const typingStore = getTyping();

	let loadedChannelId: string | null = null;

	async function loadChannel(chId: string) {
		if (loadedChannelId === chId) return;
		loadedChannelId = chId;
		// Clear previous channel's view immediately so user sees no stale messages
		setCurrentChannel(chId, []);
		hasMoreMessages = true;
		replyTo = [];
		// Fresh channel: pin to newest + reset "show removed" toggle. The
		// ResizeObserver below will keep us anchored while images decode in.
		stickToBottom = true;
		showRemoved = false;

		try {
			// Privileged viewers get deleted rows in the initial payload so the
			// toggle is pure render-time filtering (no round-trip on flip).
			// Non-privileged callers receive a stripped response either way —
			// server-side filter ignores include_deleted without the perm.
			const msgs = (await api.channels.messages(chId, {
				limit: 50,
				include_deleted: perms.canViewRemovedMessages
			})) as any[];
			if (loadedChannelId !== chId) return; // user switched again
			setCurrentChannel(chId, msgs);
			setTypingChannel(chId);
			setActiveChannelForUnread(chId);
			subscribeChannels([chId]);
			hasMoreMessages = msgs.length >= 50;
		} catch {
			if (loadedChannelId === chId) toast.error('Failed to load channel');
		}
	}

	// Client-side visibility filter. Non-priv users never have deleted rows
	// in the store to begin with (messages.svelte.ts drops them on WS + the
	// backend excludes them from HTTP). Privileged users toggle between
	// showing + hiding deleted rows here.
	const visibleMessages = $derived(
		messageStore.list.filter((m) => showRemoved || !m.deleted)
	);

	// Group consecutive messages by the same author inside a 5-minute window.
	// Replies break grouping so the reply bar always has breathing room above
	// it. The result decorates each visible row with a `grouped` flag that
	// `<MessageItem>` uses to hide the header/avatar and drop a timestamp in
	// the left gutter instead.
	const GROUP_WINDOW_MS = 5 * 60 * 1000;
	const groupedMessages = $derived.by(() => {
		const out: Array<{ msg: (typeof visibleMessages)[number]; grouped: boolean }> = [];
		let prev: (typeof visibleMessages)[number] | undefined;
		for (const m of visibleMessages) {
			const hasReply = Array.isArray(m.reply_to) ? m.reply_to.length > 0 : !!m.reply_to;
			const sameSender = !!prev && prev.sender_id === m.sender_id;
			const withinWindow =
				!!prev &&
				new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() <
					GROUP_WINDOW_MS;
			out.push({ msg: m, grouped: sameSender && withinWindow && !hasReply });
			prev = m;
		}
		return out;
	});

	$effect(() => {
		if (channelId) loadChannel(channelId);
	});

	/**
	 * React to VIEW_REMOVED_MESSAGES flipping mid-session. If the actor gains
	 * the perm we refetch the current channel with include_deleted=true to
	 * pull historical deleted rows that never entered the store. If the actor
	 * loses the perm we refetch without the flag (backend strips deleted
	 * rows) AND force the toggle off so any currently-revealed rows collapse.
	 *
	 * The backend also stops sending MESSAGE_UPDATE(deleted:true) to the
	 * demoted user after the perm change — they start receiving MESSAGE_DELETE
	 * instead. This effect keeps the initial-state of the page coherent with
	 * that new WS contract.
	 */
	let lastKnownReveal = $state<boolean | null>(null);
	$effect(() => {
		const reveal = perms.canViewRemovedMessages;
		if (lastKnownReveal === null) {
			lastKnownReveal = reveal;
			return;
		}
		if (lastKnownReveal === reveal) return;
		lastKnownReveal = reveal;
		if (!channelId || loadedChannelId !== channelId) return;
		refetchForPermChange(channelId, reveal);
	});

	async function refetchForPermChange(chId: string, reveal: boolean) {
		try {
			const msgs = (await api.channels.messages(chId, {
				limit: 50,
				include_deleted: reveal
			})) as any[];
			if (loadedChannelId !== chId) return;
			setCurrentChannel(chId, msgs);
			hasMoreMessages = msgs.length >= 50;
			if (!reveal) showRemoved = false;
		} catch {
			toast.error('Failed to refresh channel');
		}
	}

	// Handle ?jump=<messageId> hand-off from the moderation sheet. When the
	// target is already in the initially-loaded page we jump right away; when
	// it's older we keep the param in the URL and let the user scroll up /
	// infinite-load it into view.
	$effect(() => {
		const target = page.url.searchParams.get('jump');
		if (!target) return;
		// Wait a tick for the channel load to hydrate the DOM
		const attempt = () => {
			const el = document.querySelector(`[data-message-id="${CSS.escape(target)}"]`);
			if (el) {
				jumpToMessage(target);
				// Strip the query param without adding a history entry
				const url = new URL(page.url);
				url.searchParams.delete('jump');
				history.replaceState(history.state, '', url.toString());
			}
		};
		const t = setTimeout(attempt, 250);
		return () => clearTimeout(t);
	});

	// Auto-scroll on new messages (only if already near bottom).
	// The ResizeObserver below also handles image-decode growth; this effect
	// covers the case where a new message arrives but no image load follows.
	let prevMessageCount = 0;
	$effect(() => {
		const count = messageStore.list.length;
		if (count > prevMessageCount && messagesContainer && stickToBottom) {
			requestAnimationFrame(() => {
				if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
		prevMessageCount = count;
	});

	// Keep the view pinned to the bottom while the inner content height grows
	// (images decoding, reactions/edits landing). Respects `stickToBottom` so
	// a user who has scrolled up doesn't get yanked back down.
	$effect(() => {
		if (!messagesInner || !messagesContainer) return;
		const ro = new ResizeObserver(() => {
			if (!messagesContainer) return;
			if (stickToBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
		});
		ro.observe(messagesInner);
		return () => ro.disconnect();
	});

	// Scroll handler: update stick-to-bottom state + trigger older-page load
	async function handleScroll() {
		if (!messagesContainer) return;
		const distFromBottom =
			messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
		stickToBottom = distFromBottom <= STICK_SLOP_PX;

		if (loadingOlder || !hasMoreMessages) return;
		if (messagesContainer.scrollTop < 100) {
			loadingOlder = true;
			const oldestMsg = messageStore.list[0];
			if (oldestMsg) {
				try {
					const older = (await api.channels.messages(channelId, {
						before: oldestMsg.created_at,
						limit: 50,
						include_deleted: perms.canViewRemovedMessages
					})) as any[];
					if (older.length < 50) hasMoreMessages = false;
					if (older.length > 0) {
						const prevHeight = messagesContainer.scrollHeight;
						// Prepend older messages
						const current = messageStore.list;
						setCurrentChannel(channelId, [...older, ...current]);
						// Maintain scroll position
						requestAnimationFrame(() => {
							if (messagesContainer) {
								messagesContainer.scrollTop = messagesContainer.scrollHeight - prevHeight;
							}
						});
					}
				} catch {
					toast.error('Failed to load older messages');
				}
			}
			loadingOlder = false;
		}
	}

	async function handleSend(
		content: string,
		replyToIds?: string[],
		attachments?: Array<{
			url: string;
			filename: string;
			mime_type: string;
			size: number;
			width?: number;
			height?: number;
		}>
	) {
		try {
			const msg = await api.channels.send(channelId, {
				content,
				reply_to: replyToIds,
				attachments
			});
			addMessage(msg as any);
			replyTo = [];
		} catch {
			toast.error('Failed to send message');
		}
	}

	function formatDateLabel(date: Date): string {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const diff = today.getTime() - target.getTime();
		const days = diff / (1000 * 60 * 60 * 24);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
	}

	function handleReply(messageId: string) {
		// Ignore duplicates; append up to MAX_REPLIES total
		if (replyTo.some((r) => r.id === messageId)) return;
		if (replyTo.length >= MAX_REPLIES) {
			toast.error(`You can only reply to ${MAX_REPLIES} messages at a time`);
			return;
		}
		const msg = messageStore.list.find((m) => m.id === messageId);
		if (msg) replyTo = [...replyTo, { id: msg.id, content: msg.content }];
	}

	async function handleEdit(messageId: string, newContent: string) {
		try {
			await api.channels.editMessage(channelId, messageId, newContent);
		} catch {
			toast.error('Failed to edit message');
		}
	}

	async function handleDelete(messageId: string) {
		try {
			await api.channels.deleteMessage(channelId, messageId);
		} catch {
			toast.error('Failed to delete message');
		}
	}

	async function handleClearEmbeds(messageId: string) {
		try {
			await api.channels.clearEmbeds(channelId, messageId);
		} catch {
			toast.error('Failed to remove embed');
		}
	}

	async function handleReaction(messageId: string, emoji: string) {
		try {
			await api.channels.addReaction(channelId, messageId, 'unicode', emoji);
		} catch {
			toast.error('Failed to add reaction');
		}
	}

	async function handleTogglePin(messageId: string, nextPinned: boolean) {
		try {
			if (nextPinned) await api.channels.pin(channelId, messageId);
			else await api.channels.unpin(channelId, messageId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to toggle pin');
		}
	}

	function jumpToMessage(id: string) {
		const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
		if (el && el instanceof HTMLElement) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
			setTimeout(() => {
				el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
			}, 1500);
		}
	}
</script>

<div class="flex min-h-0 min-w-0 flex-1">
	{#if isVoice}
		<VoiceRoomView {channelId} {channelName} />
	{:else}
	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<!-- Channel header -->
		<div class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="flex items-center gap-2">
				<Hash class="h-5 w-5 text-muted-foreground" />
				<span class="font-semibold text-foreground">{channelName || 'channel'}</span>
				{#if channelTopic}
					<span class="text-xs text-muted-foreground">|</span>
					<span class="truncate text-xs text-muted-foreground">{channelTopic}</span>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<button
					onclick={() => (showPins = true)}
					class="rounded p-1 text-muted-foreground hover:text-foreground"
					title="Pinned messages"
				>
					<Pin class="h-5 w-5" />
				</button>
				{#if perms.canViewRemovedMessages}
					<button
						onclick={() => (showRemoved = !showRemoved)}
						class="rounded p-1 transition-colors {showRemoved
							? 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/25'
							: 'text-muted-foreground hover:text-foreground'}"
						title={showRemoved ? 'Hide removed messages' : 'Show removed messages'}
					>
						{#if showRemoved}
							<Eye class="h-5 w-5" />
						{:else}
							<EyeOff class="h-5 w-5" />
						{/if}
					</button>
				{/if}
				{#if perms.canViewAuditLog}
					<button
						onclick={() =>
							goto(
								`/channels/${encodeURIComponent(serverId)}/audit-log?channel_id=${encodeURIComponent(channelId)}`
							)}
						class="rounded p-1 text-muted-foreground hover:text-foreground"
						title="Channel audit log"
					>
						<ScrollText class="h-5 w-5" />
					</button>
				{/if}
				<button
					onclick={() => (showMembers = !showMembers)}
					class="rounded p-1 text-muted-foreground hover:text-foreground"
					title="Toggle member list"
				>
					<Users class="h-5 w-5" />
				</button>
			</div>
		</div>

		<!-- Messages -->
		<div class="flex-1 overflow-y-auto" bind:this={messagesContainer} onscroll={handleScroll}>
			{#if loadingOlder}
				<div class="py-2 text-center text-xs text-muted-foreground">Loading older messages...</div>
			{/if}

			{#if visibleMessages.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-2">
					<Hash class="h-10 w-10 text-muted-foreground/30" />
					<p class="text-sm font-medium text-foreground">Welcome to #{channelName || 'channel'}</p>
					<p class="text-xs text-muted-foreground">This is the beginning of the channel. Say something!</p>
				</div>
			{:else}
				<div bind:this={messagesInner} class="flex min-h-full flex-col justify-end py-4">
					{#each groupedMessages as { msg: message, grouped }, idx (message.id)}
						{@const msgDate = new Date(message.created_at).toDateString()}
						{@const prevDate = idx > 0 ? new Date(groupedMessages[idx - 1].msg.created_at).toDateString() : null}
						{#if msgDate !== prevDate}
							<div class="relative my-4 flex items-center justify-center">
								<div class="absolute inset-0 flex items-center"><div class="w-full border-t border-border"></div></div>
								<span class="relative bg-background px-3 text-xs font-medium text-muted-foreground">
									{formatDateLabel(new Date(message.created_at))}
								</span>
							</div>
						{/if}
						<MessageItem
							{message}
							{grouped}
							isOwn={message.sender_id === auth.identity?.did}
							serverOwnerId={serverState.activeServerOwnerId}
							canModerate={perms.canManageMessages}
							onReply={handleReply}
							onEdit={handleEdit}
							onDelete={handleDelete}
							onReact={handleReaction}
							onClearEmbeds={handleClearEmbeds}
							onTogglePin={handleTogglePin}
						/>
					{/each}
				</div>
			{/if}

		</div>

		{#if typingStore.users.length > 0}
			{@const names = typingStore.users.map((did) => displayName(getProfile(did), did))}
			<div class="px-4 py-1 text-xs text-muted-foreground">
				{names.join(', ')} {names.length === 1 ? 'is' : 'are'} typing...
			</div>
		{/if}

		<MessageInput
			{channelId}
			{channelName}
			{replyTo}
			onSend={handleSend}
			onRemoveReply={(id) => (replyTo = replyTo.filter((r) => r.id !== id))}
			disabled={!canSendHere}
		/>
	</div>
	{/if}

	{#if showMembers}
		<MemberList
			{serverId}
			serverOwnerId={serverState.activeServerOwnerId}
			canManageRoles={perms.canManageRoles}
		/>
	{/if}
</div>

<PinsPanel
	open={showPins}
	{channelId}
	canModerate={perms.canManageMessages}
	{showRemoved}
	onClose={() => (showPins = false)}
	onJump={jumpToMessage}
/>
