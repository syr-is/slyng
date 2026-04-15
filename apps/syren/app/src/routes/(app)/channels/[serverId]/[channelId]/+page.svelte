<script lang="ts">
	import { Hash, Users, Pin } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import MessageItem from '$lib/components/message-item.svelte';
	import MessageInput from '$lib/components/message-input.svelte';
	import MemberList from '$lib/components/member-list.svelte';
	import PinsPanel from '$lib/components/pins-panel.svelte';
	import VoiceRoomView from '$lib/components/voice-room-view.svelte';
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

	let showMembers = $state(true);
	let showPins = $state(false);
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
		// Fresh channel: pin to newest. The ResizeObserver below will keep us
		// anchored while images decode in.
		stickToBottom = true;

		try {
			const msgs = (await api.channels.messages(chId, { limit: 50 })) as any[];
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

	$effect(() => {
		if (channelId) loadChannel(channelId);
	});

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
						limit: 50
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

			{#if messageStore.list.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-2">
					<Hash class="h-10 w-10 text-muted-foreground/30" />
					<p class="text-sm font-medium text-foreground">Welcome to #{channelName || 'channel'}</p>
					<p class="text-xs text-muted-foreground">This is the beginning of the channel. Say something!</p>
				</div>
			{:else}
				<div bind:this={messagesInner} class="flex min-h-full flex-col justify-end py-4">
					{#each messageStore.list as message (message.id)}
						<MessageItem
							{message}
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
	onClose={() => (showPins = false)}
	onJump={jumpToMessage}
/>
