<script lang="ts">
	import * as Avatar from '@slyng/ui/avatar';
	import { Hash, X, Loader2, AtSign, RefreshCw } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';
	import { proxied } from '@slyng/app-core/utils/proxy';
	import { renderEmojis } from '@slyng/app-core/utils/emoji-render';
	import {
		getMentionInbox,
		loadMentionInbox,
		dismissMention,
		type MentionEntry
	} from '@slyng/app-core/stores/mention-inbox.svelte';
	import MentionChip from '@slyng/ui/fragments/mention-chip.svelte';

	/**
	 * Global mention inbox. `/mentions` spans every server the caller belongs
	 * to, so this lives under @me rather than in a server's channel header —
	 * nothing here is scoped to the channel you happened to be looking at.
	 * Kept live by MENTION_ADD; jumping navigates to the source channel.
	 */
	const inbox = getMentionInbox();

	$effect(() => {
		void loadMentionInbox();
	});

	function formatTime(iso: string) {
		return new Date(iso).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function openMention(entry: MentionEntry) {
		if (!entry.server_id) return;
		goto(
			`/channels/${encodeURIComponent(entry.server_id)}/${encodeURIComponent(entry.channel_id)}?jump=${encodeURIComponent(entry.id)}`
		);
	}
</script>

<div class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
	<h1 class="text-sm font-semibold">
		Inbox{#if inbox.count > 0}&nbsp;·&nbsp;{inbox.count}{/if}
	</h1>
	<button
		type="button"
		onclick={() => void loadMentionInbox()}
		disabled={inbox.loading}
		class="flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 motion-safe:active:scale-95"
		aria-label="Refresh mentions"
	>
		<RefreshCw class="h-4 w-4 {inbox.loading ? 'animate-spin' : ''}" />
	</button>
</div>

<main class="flex-1 overflow-y-auto">
	<div class="mx-auto max-w-2xl p-4 sm:p-6">
		{#if inbox.loading && inbox.entries.length === 0}
			<div class="flex items-center justify-center py-16 text-muted-foreground">
				<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading…
			</div>
		{:else if inbox.entries.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
				<AtSign class="h-8 w-8 text-muted-foreground/40" />
				<p class="text-sm font-medium text-foreground">No mentions</p>
				<p class="text-xs text-muted-foreground">
					When someone @mentions you in any server it shows up here.
				</p>
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
							class="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100 tap:opacity-100"
							onclick={() => dismissMention(entry.id)}
							aria-label="Dismiss"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</main>
