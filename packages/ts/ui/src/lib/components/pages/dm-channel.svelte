<script lang="ts">
	import { MessageSquare, Ban, EyeOff } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Avatar from '@syren/ui/avatar';
	import MessageItem from '@syren/ui/fragments/message-item.svelte';
	import MessageInput from '@syren/ui/fragments/message-input.svelte';
	import ProfileHoverCard from '@syren/ui/fragments/profile-hover-card.svelte';
	import { onDestroy } from 'svelte';
	import { api } from '@syren/app-core/api';
	import { subscribeChannels, unsubscribeChannels } from '@syren/app-core/stores/ws.svelte';
	import { setCurrentChannel, getMessages, addMessage } from '@syren/app-core/stores/messages.svelte';
	import { setTypingChannel, getTyping } from '@syren/app-core/stores/typing.svelte';
	import { resolveProfile, displayName, federatedHandle, getProfile } from '@syren/app-core/stores/profiles.svelte';
	import { setActiveChannelForUnread } from '@syren/app-core/stores/unread.svelte';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { formatDateLabel } from '@syren/app-core/utils/date';
	import { page } from '$app/state';

	const auth = getAuth();
	const relations = getRelations();
	const channelId = $derived(page.params.channelId ?? '');

	// DM metadata — the other participant's DID + instance URL. Populated
	// from `api.users.dmChannels()` on load so the header resolves their
	// federated profile.
	let otherDid = $state<string | null>(null);
	let otherInstance = $state<string | null>(null);

	const MAX_REPLIES = 5;
	let replyTo = $state<{ id: string; content: string }[]>([]);
	let messagesContainer: HTMLDivElement | undefined = $state();
	let messagesInner: HTMLDivElement | undefined = $state();
	let loadingOlder = $state(false);
	let hasMoreMessages = $state(true);
	let stickToBottom = $state(true);
	const STICK_SLOP_PX = 60;

	const messageStore = getMessages();
	const typingStore = getTyping();

	let loadedChannelId: string | null = null;
	// Track the channel topic we last subscribed to so a fast DM-switch
	// (or component teardown) can drop the stale sub before opening the
	// next one. Without this, every visited DM keeps generating WS
	// traffic against this socket for the rest of the session.
	let subscribedChannelId: string | null = null;

	async function loadChannel(chId: string) {
		if (loadedChannelId === chId) return;
		loadedChannelId = chId;
		setCurrentChannel(chId, []);
		hasMoreMessages = true;
		replyTo = [];
		stickToBottom = true;
		otherDid = null;
		otherInstance = null;
		if (subscribedChannelId && subscribedChannelId !== chId) {
			unsubscribeChannels([subscribedChannelId]);
			subscribedChannelId = null;
		}

		try {
			// Resolve the other participant from the DM list so the header has
			// a name/avatar before messages render. Cheap — the list is short.
			const dms = (await api.users.dmChannels()) as Array<{
				id: string;
				other_user_id: string | null;
				other_user_instance_url?: string | null;
			}>;
			const dm = dms.find((c) => c.id === chId);
			if (dm) {
				otherDid = dm.other_user_id ?? null;
				otherInstance =
					dm.other_user_instance_url ??
					(otherDid ? relations.instanceFor(otherDid) ?? null : null);
			}

			const msgs = await api.channels.messages(chId, { limit: 50 });
			if (loadedChannelId !== chId) return;
			setCurrentChannel(chId, msgs);
			setTypingChannel(chId);
			setActiveChannelForUnread(chId);
			subscribeChannels([chId]);
			subscribedChannelId = chId;
			hasMoreMessages = msgs.length >= 50;
		} catch (err) {
			if (loadedChannelId === chId) {
				toast.error(err instanceof Error ? err.message : 'Failed to load conversation');
			}
		}
	}

	$effect(() => {
		if (channelId) loadChannel(channelId);
	});

	onDestroy(() => {
		if (subscribedChannelId) {
			unsubscribeChannels([subscribedChannelId]);
			subscribedChannelId = null;
		}
	});

	const visibleMessages = $derived(messageStore.list.filter((m) => !m.deleted));

	// Group consecutive messages by the same author inside a 5-minute window
	// (same grouping rule as the server channel page).
	const GROUP_WINDOW_MS = 5 * 60 * 1000;
	const groupedMessages = $derived.by(() => {
		const out: Array<{ msg: (typeof visibleMessages)[number]; grouped: boolean }> = [];
		let prev: (typeof visibleMessages)[number] | undefined;
		for (const m of visibleMessages) {
			const hasReply = Array.isArray(m.reply_to) ? m.reply_to.length > 0 : !!m.reply_to;
			const sameSender = !!prev && prev.sender_id === m.sender_id;
			const withinWindow =
				!!prev &&
				new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
			out.push({ msg: m, grouped: sameSender && withinWindow && !hasReply });
			prev = m;
		}
		return out;
	});

	// Auto-scroll on new messages when user is anchored near the bottom.
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

	$effect(() => {
		if (!messagesInner || !messagesContainer) return;
		const ro = new ResizeObserver(() => {
			if (!messagesContainer) return;
			if (stickToBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
		});
		ro.observe(messagesInner);
		return () => ro.disconnect();
	});

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
				// Snapshot the channel id so a fast DM-switch mid-fetch
				// can't commit older messages onto the new channel.
				const reqChannelId = channelId;
				try {
					const older = await api.channels.messages(reqChannelId, {
						before: oldestMsg.created_at,
						limit: 50
					});
					// Don't `return` here — the `loadingOlder = false` at the
					// bottom needs to run so the next scroll attempt isn't
					// silently blocked. Just skip the commit.
					if (loadedChannelId === reqChannelId) {
						if (older.length < 50) hasMoreMessages = false;
						if (older.length > 0) {
							const prevHeight = messagesContainer.scrollHeight;
							const current = messageStore.list;
							setCurrentChannel(reqChannelId, [...older, ...current]);
							requestAnimationFrame(() => {
								if (messagesContainer) {
									messagesContainer.scrollTop = messagesContainer.scrollHeight - prevHeight;
								}
							});
						}
					}
				} catch {
					if (loadedChannelId === reqChannelId) toast.error('Failed to load older messages');
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
		const reqChannelId = channelId;
		try {
			const msg = await api.channels.send(reqChannelId, {
				content,
				reply_to: replyToIds,
				attachments
			});
			if (loadedChannelId !== reqChannelId) return;
			addMessage(msg);
			replyTo = [];
		} catch (err) {
			// Surface the real reason (DM policy / block / etc.) — the backend
			// returns a user-facing message for canDM rejections.
			if (loadedChannelId === reqChannelId) {
				toast.error(err instanceof Error ? err.message : 'Failed to send message');
			}
		}
	}


	function handleReply(messageId: string) {
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

	// Profile of the other participant for the header. Falls back to the
	// local relations cache when the DM list didn't carry an instance URL
	// (shouldn't happen — backend always attaches it — but defensive).
	const otherProfile = $derived(
		otherDid ? resolveProfile(otherDid, otherInstance ?? undefined) : null
	);
	const otherName = $derived(otherDid && otherProfile ? displayName(otherProfile, otherDid) : 'Direct Message');
	const otherHandle = $derived(otherDid && otherProfile ? federatedHandle(otherProfile, otherDid) : '');

	// Warning banners for the DM peer's relation state. Block + ignore are
	// still rendered per-message by <MessageItem>; these banners give the
	// overall "heads-up, this person is blocked/ignored" context.
	const isBlocked = $derived(otherDid ? relations.isBlocked(otherDid) : false);
	const isIgnored = $derived(otherDid ? relations.isIgnored(otherDid) : false);
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	<!-- DM header -->
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
		{#if otherDid && otherProfile}
			<ProfileHoverCard did={otherDid} instanceUrl={otherInstance ?? undefined}>
				<div class="flex items-center gap-2">
					<Avatar.Root class="h-7 w-7">
						{#if otherProfile.avatar_url}
							<Avatar.Image src={proxied(otherProfile.avatar_url)} alt={otherName} />
						{/if}
						<Avatar.Fallback class="text-xs">
							{otherName.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
					<span class="font-semibold text-foreground">{otherName}</span>
					{#if otherHandle}
						<span class="truncate font-mono text-[11px] text-muted-foreground">{otherHandle}</span>
					{/if}
				</div>
			</ProfileHoverCard>
		{:else}
			<MessageSquare class="h-5 w-5 text-muted-foreground" />
			<span class="font-semibold text-foreground">Direct Message</span>
		{/if}
	</div>

	{#if isBlocked}
		<div class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
			<Ban class="h-3.5 w-3.5 shrink-0" />
			<span>
				You've blocked this user. Their messages are hidden by default — unblock them from their
				profile to restore normal delivery.
			</span>
		</div>
	{:else if isIgnored}
		<div class="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
			<EyeOff class="h-3.5 w-3.5 shrink-0" />
			<span>You've ignored this user. Their messages still arrive but don't notify.</span>
		</div>
	{/if}

	<!-- Messages -->
	<div class="flex-1 overflow-y-auto" bind:this={messagesContainer} onscroll={handleScroll}>
		{#if loadingOlder}
			<div class="py-2 text-center text-xs text-muted-foreground">Loading older messages...</div>
		{/if}

		{#if visibleMessages.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-2">
				<MessageSquare class="h-10 w-10 text-muted-foreground/30" />
				<p class="text-sm font-medium text-foreground">
					{otherDid ? `Say hi to ${otherName}` : 'This is the start of your conversation'}
				</p>
				<p class="text-xs text-muted-foreground">No messages yet.</p>
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
						onReply={handleReply}
						onEdit={handleEdit}
						onDelete={handleDelete}
						onReact={handleReaction}
						onClearEmbeds={handleClearEmbeds}
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
		channelName={otherName}
		{replyTo}
		onSend={handleSend}
		onRemoveReply={(id) => (replyTo = replyTo.filter((r) => r.id !== id))}
	/>
</div>
