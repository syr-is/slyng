<script lang="ts">
	import { Plus, Smile, Send, X, FileIcon, ImageIcon, Loader2, Cloud, Sticker, Reply } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { sendTyping } from '$lib/stores/ws.svelte';
	import EmojiPicker from './emoji-picker.svelte';
	import GifPicker from './gif-picker.svelte';
	import SyrUploadPicker from './syr-upload-picker.svelte';
	import { uploadFile, type Attachment, type UploadHandle } from '$lib/upload/upload-client';
	import { proxied } from '$lib/utils/proxy';

	const {
		channelId,
		channelName,
		replyTo = [],
		onSend,
		onRemoveReply
	}: {
		channelId: string;
		channelName?: string;
		replyTo?: { id: string; content: string }[];
		onSend: (content: string, replyToIds?: string[], attachments?: Attachment[]) => void;
		onRemoveReply?: (id: string) => void;
	} = $props();

	interface PendingUpload {
		id: string;
		file: File;
		handle: UploadHandle;
		progress: number;
		error?: string;
		attachment?: Attachment;
	}

	let content = $state('');
	let lastTypingSent = 0;
	let showEmojiPicker = $state(false);
	let showGifPicker = $state(false);
	let showSyrPicker = $state(false);
	let dragOver = $state(false);
	let inputEl: HTMLTextAreaElement | undefined = $state();
	let fileInput: HTMLInputElement | undefined = $state();

	// Uploads in flight + finished local attachments (mix)
	let pending = $state<PendingUpload[]>([]);
	let readyAttachments = $state<Attachment[]>([]); // added via non-upload paths (syr picker, gif picker)

	const hasPending = $derived(pending.some((p) => !p.attachment && !p.error));
	const canSend = $derived(
		!hasPending &&
			(content.trim().length > 0 ||
				readyAttachments.length > 0 ||
				pending.some((p) => !!p.attachment))
	);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
			return;
		}
	}

	// `oninput` fires after the textarea value actually changes — catches
	// keystrokes, paste, IME composition, autocomplete. Fire typing on the
	// first input, then throttle so we don't flood the WS.
	function handleInput() {
		const now = Date.now();
		// Re-arm faster than the receiver's 3.5s auto-clear so sustained
		// typers stay lit; new typers light up immediately.
		if (now - lastTypingSent > 2000) {
			sendTyping(channelId);
			lastTypingSent = now;
		}
	}

	function submit() {
		if (!canSend) return;
		const text = content.trim();
		const finishedUploads = pending.filter((p) => !!p.attachment).map((p) => p.attachment!);
		const attachments = [...finishedUploads, ...readyAttachments];
		onSend(text, replyTo.map((r) => r.id), attachments);
		content = '';
		pending = [];
		// After sending, any new keystroke should immediately re-fire typing.
		lastTypingSent = 0;
		readyAttachments = [];
		showEmojiPicker = false;
	}

	function insertEmoji(emoji: string) {
		const el = inputEl;
		if (!el) {
			content += emoji;
			return;
		}
		const start = el.selectionStart ?? content.length;
		const end = el.selectionEnd ?? content.length;
		content = content.slice(0, start) + emoji + content.slice(end);
		// restore caret
		queueMicrotask(() => {
			el.focus();
			const pos = start + emoji.length;
			el.setSelectionRange(pos, pos);
		});
	}

	function queueFile(file: File) {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const entry: PendingUpload = {
			id,
			file,
			progress: 0,
			handle: uploadFile(file, {
				channelId,
				onProgress: (p) => {
					const idx = pending.findIndex((x) => x.id === id);
					if (idx < 0) return;
					const next = [...pending];
					next[idx] = { ...next[idx], progress: p };
					pending = next;
				}
			})
		};
		pending = [...pending, entry];

		entry.handle.promise
			.then((attachment) => {
				const idx = pending.findIndex((x) => x.id === id);
				if (idx < 0) return;
				const next = [...pending];
				next[idx] = { ...next[idx], progress: 1, attachment };
				pending = next;
			})
			.catch((err) => {
				const idx = pending.findIndex((x) => x.id === id);
				if (idx < 0) return;
				const next = [...pending];
				next[idx] = { ...next[idx], error: err instanceof Error ? err.message : 'Upload failed' };
				pending = next;
				toast.error(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
			});
	}

	function removePending(id: string) {
		const entry = pending.find((x) => x.id === id);
		if (entry && !entry.attachment && !entry.error) entry.handle.cancel();
		pending = pending.filter((x) => x.id !== id);
	}

	function removeReady(index: number) {
		readyAttachments = readyAttachments.filter((_, i) => i !== index);
	}

	function handleFilePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = input.files;
		if (!files) return;
		for (const f of Array.from(files)) queueFile(f);
		input.value = '';
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const files = e.dataTransfer?.files;
		if (!files) return;
		for (const f of Array.from(files)) queueFile(f);
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		let consumed = false;
		for (const item of Array.from(items)) {
			if (item.kind === 'file') {
				const file = item.getAsFile();
				if (file) {
					queueFile(file);
					consumed = true;
				}
			}
		}
		if (consumed) e.preventDefault();
	}

	function handleSyrPicked(attachment: Attachment) {
		readyAttachments = [...readyAttachments, attachment];
	}

	function handleGifPicked(gif: { url: string; size?: number; mime_type?: string }) {
		readyAttachments = [
			...readyAttachments,
			{
				url: gif.url,
				filename: gif.url.split('/').pop() ?? 'gif',
				mime_type: gif.mime_type ?? 'image/gif',
				size: gif.size ?? 0
			}
		];
		showGifPicker = false;
	}

	function formatSize(bytes: number): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div
	class="relative flex max-h-[40vh] shrink-0 flex-col border-t border-border px-4 pb-4 pt-2"
	ondragenter={(e) => {
		e.preventDefault();
		dragOver = true;
	}}
	ondragover={(e) => {
		e.preventDefault();
		dragOver = true;
	}}
	ondragleave={(e) => {
		if (e.target === e.currentTarget) dragOver = false;
	}}
	ondrop={handleDrop}
>
	{#if dragOver}
		<div
			class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary"
		>
			Drop files to attach
		</div>
	{/if}

	{#if replyTo.length > 0}
		<div class="mb-2 flex flex-col gap-1">
			<div class="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
				<span>Replying to {replyTo.length} message{replyTo.length === 1 ? '' : 's'}</span>
				<span class="text-[10px]">{replyTo.length}/5 — click <Reply class="inline h-3 w-3" /> on any message to add another</span>
			</div>
			{#each replyTo as r (r.id)}
				<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
					<Reply class="h-3 w-3 shrink-0" />
					<span class="flex-1 truncate">{r.content || '[attachment]'}</span>
					<button
						onclick={() => onRemoveReply?.(r.id)}
						class="shrink-0 rounded p-0.5 hover:bg-accent"
						title="Remove from reply"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Pending + ready attachment tray -->
	{#if pending.length > 0 || readyAttachments.length > 0}
		<div class="mb-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
			{#each pending as p (p.id)}
				<div class="group relative flex w-40 items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
					{#if p.file.type.startsWith('image/')}
						{#if p.attachment?.url}
							<img src={proxied(p.attachment.url)} alt="" class="h-10 w-10 rounded object-cover" />
						{:else}
							<ImageIcon class="h-10 w-10 shrink-0 text-muted-foreground" />
						{/if}
					{:else}
						<FileIcon class="h-10 w-10 shrink-0 text-muted-foreground" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-xs font-medium">{p.file.name}</p>
						<p class="text-[10px] text-muted-foreground">{formatSize(p.file.size)}</p>
						{#if p.error}
							<p class="text-[10px] text-destructive">{p.error}</p>
						{:else if p.attachment}
							<p class="text-[10px] text-green-500">Ready</p>
						{:else}
							<div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full bg-primary transition-[width]" style="width: {p.progress * 100}%"></div>
							</div>
						{/if}
					</div>
					{#if !p.attachment && !p.error}
						<Loader2 class="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
					{/if}
					<button
						onclick={() => removePending(p.id)}
						class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Remove"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}

			{#each readyAttachments as a, i (a.url)}
				<div class="group relative flex w-40 items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
					{#if a.mime_type.startsWith('image/')}
						<img src={proxied(a.url)} alt="" class="h-10 w-10 rounded object-cover" />
					{:else}
						<FileIcon class="h-10 w-10 shrink-0 text-muted-foreground" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-xs font-medium">{a.filename}</p>
						<p class="text-[10px] text-muted-foreground">{formatSize(a.size)}</p>
					</div>
					<button
						onclick={() => removeReady(i)}
						class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Remove"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex items-end gap-2 rounded-lg bg-muted/40 px-3 py-2">
		<input
			type="file"
			multiple
			class="hidden"
			bind:this={fileInput}
			onchange={handleFilePick}
		/>
		<button
			class="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground"
			title="Attach file"
			onclick={() => fileInput?.click()}
		>
			<Plus class="h-5 w-5" />
		</button>

		<button
			class="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground"
			title="From my syr uploads"
			onclick={() => (showSyrPicker = true)}
		>
			<Cloud class="h-5 w-5" />
		</button>

		<textarea
			bind:this={inputEl}
			bind:value={content}
			onkeydown={handleKeydown}
			oninput={handleInput}
			onpaste={handlePaste}
			placeholder="Message #{channelName || 'channel'}"
			rows={1}
			class="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
		></textarea>

		<button
			onclick={() => {
				showGifPicker = !showGifPicker;
				showEmojiPicker = false;
			}}
			class="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground"
			title="GIFs"
		>
			<Sticker class="h-5 w-5" />
		</button>

		<button
			onclick={() => {
				showEmojiPicker = !showEmojiPicker;
				showGifPicker = false;
			}}
			class="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground"
			title="Emoji"
		>
			<Smile class="h-5 w-5" />
		</button>

		{#if canSend}
			<button onclick={submit} class="shrink-0 pb-0.5 text-primary hover:text-primary/80" title="Send">
				<Send class="h-5 w-5" />
			</button>
		{/if}
	</div>

	{#if showEmojiPicker}
		<div class="absolute bottom-full right-4 z-50 mb-2">
			<EmojiPicker
				onSelect={(emoji) => {
					insertEmoji(emoji);
					showEmojiPicker = false;
				}}
				onClose={() => (showEmojiPicker = false)}
			/>
		</div>
	{/if}

	{#if showGifPicker}
		<div class="absolute bottom-full right-4 z-50 mb-2">
			<GifPicker onSelect={handleGifPicked} onClose={() => (showGifPicker = false)} />
		</div>
	{/if}

	{#if showSyrPicker}
		<SyrUploadPicker
			open={true}
			onPick={handleSyrPicked}
			onClose={() => (showSyrPicker = false)}
		/>
	{/if}
</div>
