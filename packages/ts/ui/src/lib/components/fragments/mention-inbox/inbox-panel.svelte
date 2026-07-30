<script lang="ts">
	import * as Dialog from '@slyng/ui/dialog';
	import * as Tabs from '@slyng/ui/tabs';
	import * as Avatar from '@slyng/ui/avatar';
	import { Inbox, Hash, X, Loader2, AtSign } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import { renderEmojis } from '@slyng/app-core/utils/emoji-render';
	import { getServerState } from '@slyng/app-core/stores/servers.svelte';
	import { getUnread } from '@slyng/app-core/stores/unread.svelte';
	import {
		getMentionInbox,
		loadMentionInbox,
		dismissMention,
		type MentionEntry
	} from '@slyng/app-core/stores/mention-inbox.svelte';
	import MentionChip from '../mention-chip.svelte';

	/**
	 * Discord-style inbox. "Mentions" is the global feed of messages that ping
	 * the current user (seeded from `/mentions`, kept live by MENTION_ADD).
	 * "Unreads" lists the active server's channels with unread activity. Both
	 * jump to the target and close.
	 */
	const {
		open,
		currentServerId,
		currentChannelId,
		onClose,
		onJump
	}: {
		open: boolean;
		currentServerId: string;
		currentChannelId: string;
		onClose: () => void;
		/** Same-channel jump: scroll + highlight a message already in the DOM. */
		onJump: (messageId: string) => void;
	} = $props();

	const inbox = getMentionInbox();
	const serverState = getServerState();

	// Load the mention feed the first time the panel opens (and refresh on
	// subsequent opens so a long-lived session picks up server-side changes).
	$effect(() => {
		if (open) void loadMentionInbox();
	});

	const unreadChannels = $derived(
		serverState.channels
			.filter((c) => c.type !== 'voice')
			.map((c) => ({ id: c.id, name: c.name ?? '', unread: getUnread(c.id) }))
			.filter((c) => c.unread.count > 0 || c.unread.mentionCount > 0)
	);

	function formatTime(iso: string) {
		return new Date(iso).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function openMention(entry: MentionEntry) {
		onClose();
		if (entry.server_id === currentServerId && entry.channel_id === currentChannelId) {
			onJump(entry.id);
		} else if (entry.server_id) {
			goto(
				`/channels/${encodeURIComponent(entry.server_id)}/${encodeURIComponent(entry.channel_id)}?jump=${encodeURIComponent(entry.id)}`
			);
		}
	}

	function openChannel(channelId: string) {
		onClose();
		goto(`/channels/${encodeURIComponent(currentServerId)}/${encodeURIComponent(channelId)}`);
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
		<Dialog.Header class="border-b border-border p-3 text-left">
			<Dialog.Title class="flex items-center gap-2 text-base">
				<Inbox class="h-4 w-4" /> Inbox
			</Dialog.Title>
		</Dialog.Header>

		<Tabs.Root value="mentions" class="flex min-h-0 flex-1 flex-col">
			<Tabs.List class="mx-3 mt-3 grid w-auto grid-cols-2">
				<Tabs.Trigger value="mentions">
					Mentions
					{#if inbox.count > 0}
						<span class="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
							{inbox.count}
						</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="unreads">
					Unreads
					{#if unreadChannels.length > 0}
						<span class="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
							{unreadChannels.length}
						</span>
					{/if}
				</Tabs.Trigger>
			</Tabs.List>

			<!-- Mentions -->
			<Tabs.Content value="mentions" class="min-h-0 flex-1 overflow-y-auto p-3">
				{#if inbox.loading && inbox.entries.length === 0}
					<div class="flex items-center justify-center py-12 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading…
					</div>
				{:else if inbox.entries.length === 0}
					<div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
						<AtSign class="h-8 w-8 text-muted-foreground/40" />
						<p class="text-sm font-medium text-foreground">No mentions</p>
						<p class="text-xs text-muted-foreground">When someone @mentions you it shows up here.</p>
					</div>
				{:else}
					<div class="space-y-1.5">
						{#each inbox.entries as entry (entry.id)}
							{@const profile = resolveProfile(entry.sender_id, entry.sender_instance_url)}
							<div class="group relative flex gap-3 rounded-md border border-border bg-muted/30 p-3">
								<Avatar.Root class="h-8 w-8 shrink-0">
									{#if profile.avatar_url}<Avatar.Image src={proxied(profile.avatar_url)} alt="" />{/if}
									<Avatar.Fallback class="text-xs">
										{displayName(profile, entry.sender_id).slice(0, 2).toUpperCase()}
									</Avatar.Fallback>
								</Avatar.Root>
								<button type="button" onclick={() => openMention(entry)} class="min-w-0 flex-1 text-left">
									<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-5">
										<span class="truncate text-sm font-medium text-foreground">
											{displayName(profile, entry.sender_id)}
										</span>
										{#if entry.channel_name}
											<span class="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
												<Hash class="h-3 w-3" />{entry.channel_name}
											</span>
										{/if}
										<span class="text-[11px] text-muted-foreground">{formatTime(entry.created_at)}</span>
									</div>
									{#if entry.content}
										<p class="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
											{#each renderEmojis(entry.content, undefined) as tok, i (i)}
												{#if tok.kind === 'text'}{tok.value}
												{:else if tok.kind === 'mention'}<MentionChip did={tok.did} />
												{:else if tok.kind === 'link'}<span class="text-primary">{tok.url}</span>
												{:else if tok.kind === 'emoji' || tok.kind === 'sticker'}:{tok.shortcode}:
												{:else if tok.kind === 'unknown_shortcode'}:{tok.shortcode}:{/if}
											{/each}
										</p>
									{:else if (entry.attachments?.length ?? 0) > 0}
										<p class="mt-0.5 text-xs text-muted-foreground">[attachment]</p>
									{/if}
								</button>
								<button
									type="button"
									class="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
									onclick={() => dismissMention(entry.id)}
									aria-label="Dismiss"
								>
									<X class="h-3.5 w-3.5" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</Tabs.Content>

			<!-- Unreads (active server) -->
			<Tabs.Content value="unreads" class="min-h-0 flex-1 overflow-y-auto p-3">
				{#if unreadChannels.length === 0}
					<div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
						<Inbox class="h-8 w-8 text-muted-foreground/40" />
						<p class="text-sm font-medium text-foreground">All caught up</p>
						<p class="text-xs text-muted-foreground">No unread channels in this server.</p>
					</div>
				{:else}
					<div class="space-y-1">
						{#each unreadChannels as ch (ch.id)}
							<button
								type="button"
								onclick={() => openChannel(ch.id)}
								class="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left hover:border-primary/40 hover:bg-accent/40"
							>
								<Hash class="h-4 w-4 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate text-sm text-foreground">{ch.name}</span>
								{#if ch.unread.mentionCount > 0}
									<span class="rounded-full bg-amber-400/20 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
										@{ch.unread.mentionCount}
									</span>
								{/if}
								<span class="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
									{ch.unread.count}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</Dialog.Content>
</Dialog.Root>
