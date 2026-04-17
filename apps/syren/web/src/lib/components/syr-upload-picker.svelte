<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Loader2, ImageIcon, VideoIcon, FileIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getAuth } from '$lib/stores/auth.svelte';
	import type { Attachment } from '$lib/upload/upload-client';

	interface SyrUpload {
		id: string;
		did?: string;
		local_id?: string;
		url?: string;
		filename: string;
		mime_type: string;
		size: number;
		status: string;
		metadata?: { width?: number; height?: number };
	}

	const {
		open,
		onPick,
		onClose
	}: {
		open: boolean;
		onPick: (attachment: Attachment) => void;
		onClose: () => void;
	} = $props();

	const auth = getAuth();
	const instance = $derived(auth.identity?.syr_instance_url);

	let uploads = $state<SyrUpload[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (open && instance) load();
	});

	async function load() {
		loading = true;
		error = null;
		try {
			// Proxy through syren API — direct cross-origin fetch won't send syr cookies
			const syrPath = '/api/uploads?limit=60&sort_field=created_at&sort_order=desc';
			const res = await fetch(
				`/api/syr-proxy?path=${encodeURIComponent(syrPath)}`,
				{ credentials: 'include' }
			);
			if (!res.ok) throw new Error(`Failed: ${res.status}`);
			const body = await res.json();
			const all: SyrUpload[] = Array.isArray(body.data) ? body.data : [];
			uploads = all.filter(
				(u) =>
					u.status === 'completed' &&
					!!u.url &&
					u.mime_type &&
					(u.mime_type.startsWith('image/') || u.mime_type.startsWith('video/'))
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load from your syr instance';
		}
		loading = false;
	}

	function pick(u: SyrUpload) {
		if (!u.url) return;
		const attachment: Attachment = {
			url: u.url,
			filename: u.filename,
			mime_type: u.mime_type,
			size: u.size,
			width: u.metadata?.width,
			height: u.metadata?.height
		};
		onPick(attachment);
		toast.success(`Attached ${u.filename}`);
		onClose();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Attach from your syr uploads</Dialog.Title>
			<Dialog.Description>
				Files already on your syr instance. Pick one to reference it directly — syren
				won't re-upload or copy it.
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-[60vh] overflow-y-auto py-2">
			{#if !instance}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No linked syr instance.
				</p>
			{:else if loading}
				<div class="flex items-center justify-center py-12 text-muted-foreground">
					<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading uploads...
				</div>
			{:else if error}
				<p class="py-8 text-center text-sm text-destructive">{error}</p>
			{:else if uploads.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No eligible uploads.
				</p>
			{:else}
				<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
					{#each uploads as u (u.id)}
						<button
							type="button"
							onclick={() => pick(u)}
							class="group relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary"
							title={u.filename}
						>
							{#if u.mime_type.startsWith('image/') && u.url}
								<img
									src={u.url}
									alt={u.filename}
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{:else if u.mime_type.startsWith('video/') && u.url}
								<video
									src={u.url}
									class="h-full w-full object-cover"
									muted
									playsinline
									preload="metadata"
								></video>
								<VideoIcon class="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-muted-foreground">
									<FileIcon class="h-6 w-6" />
								</div>
							{/if}
							<div
								class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-left text-[11px] text-white"
							>
								<span class="line-clamp-1">{u.filename}</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
