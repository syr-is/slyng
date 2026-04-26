<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import * as Avatar from '@syren/ui/avatar';
	import { PinOff, Pin, Loader2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { WsOp } from '@syren/types';
	import { api } from '@syren/app-core/api';
	import { onWsEvent } from '@syren/app-core/stores/ws.svelte';
	import { resolveProfile, displayName } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	interface PinnedMsg {
		id: string;
		sender_id: string;
		sender_instance_url?: string;
		content: string;
		created_at: string;
		deleted?: boolean;
		deleted_at?: string;
		deleted_by?: string;
		attachments?: { url: string; filename: string; mime_type: string }[];
	}

	const {
		open,
		channelId,
		canModerate,
		showRemoved = false,
		onClose,
		onJump
	}: {
		open: boolean;
		channelId: string;
		canModerate: boolean;
		/** Mirrors the channel header's "show removed messages" toggle. */
		showRemoved?: boolean;
		onClose: () => void;
		onJump: (messageId: string) => void;
	} = $props();

	let pins = $state<PinnedMsg[]>([]);
	let loading = $state(false);

	// Refetch when the panel opens OR when the channel-level toggle flips.
	// The second dep covers a privileged mod flipping the channel eye while
	// the panel is already open.
	$effect(() => {
		if (open && channelId) {
			void showRemoved;
			load();
		}
	});

	async function load() {
		loading = true;
		try {
			pins = (await api.channels.pins(channelId, {
				include_deleted: showRemoved
			})) as PinnedMsg[];
		} catch {
			toast.error('Failed to load pins');
		}
		loading = false;
	}

	async function handleUnpin(messageId: string) {
		try {
			await api.channels.unpin(channelId, messageId);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unpin');
		}
	}

	function handleJump(id: string) {
		onJump(id);
		onClose();
	}

	function formatTime(iso: string) {
		return new Date(iso).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Live updates while panel open
	onWsEvent(WsOp.PIN_REMOVE, (data) => {
		if (!open) return;
		const { message_id, channel_id } = data as { message_id: string; channel_id: string };
		if (channel_id !== channelId) return;
		pins = pins.filter((p) => p.id !== message_id);
	});

	onWsEvent(WsOp.PIN_ADD, (data) => {
		if (!open) return;
		const { channel_id } = data as { channel_id: string };
		if (channel_id !== channelId) return;
		load();
	});
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="max-h-[80vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Pin class="h-4 w-4" />
				Pinned messages
			</Dialog.Title>
			<Dialog.Description>
				{pins.length} {pins.length === 1 ? 'pin' : 'pins'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2 py-2">
			{#if loading}
				<div class="flex items-center justify-center py-8 text-muted-foreground">
					<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading...
				</div>
			{:else if pins.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No pinned messages yet. Pin a message to save it for later.
				</p>
			{:else}
				{#each pins as pin (pin.id)}
					{@const profile = resolveProfile(pin.sender_id, pin.sender_instance_url)}
					<div
						class="group flex gap-3 rounded-md border p-3 {pin.deleted
							? 'border-destructive/30 bg-destructive/5'
							: 'border-border bg-muted/30'}"
					>
						<Avatar.Root class="h-8 w-8 shrink-0">
							{#if profile.avatar_url}
								<Avatar.Image src={proxied(profile.avatar_url)} alt="" />
							{/if}
							<Avatar.Fallback class="text-xs">
								{displayName(profile, pin.sender_id).slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<button
							type="button"
							onclick={() => handleJump(pin.id)}
							class="min-w-0 flex-1 text-left"
						>
							<div class="flex items-baseline gap-2">
								<span class="truncate text-sm font-medium text-foreground">
									{displayName(profile, pin.sender_id)}
								</span>
								<span class="text-[11px] text-muted-foreground">{formatTime(pin.created_at)}</span>
								{#if pin.deleted}
									<span
										class="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-destructive"
									>
										removed
									</span>
								{/if}
							</div>
							<p class="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
								{pin.content || (pin.attachments?.length ? '[attachment]' : '')}
							</p>
						</button>
						{#if canModerate}
							<button
								onclick={() => handleUnpin(pin.id)}
								class="shrink-0 self-start rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100 tap:opacity-100"
								title="Unpin"
							>
								<PinOff class="h-4 w-4" />
							</button>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
