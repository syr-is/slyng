<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Loader2, Plus, Trash2, Clock } from '@lucide/svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import {
		listStories,
		uploadStory,
		deleteStory,
		type OwnedStory
	} from '@syren/app-core/upload/idp-upload';

	/**
	 * Story composer for local accounts — upload a slide (image/video),
	 * publishes it to the 24h public reel, and manage existing stories.
	 * Reuses the IdP upload helper (presign → PUT → complete).
	 */
	const { onChanged }: { onChanged?: () => void } = $props();

	let stories = $state<OwnedStory[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let removing = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	const WINDOW_MS = 24 * 60 * 60 * 1000;
	function isActive(s: OwnedStory): boolean {
		if (s.status !== 'completed' || !s.is_public || !s.is_story || !s.published_at) return false;
		return Date.now() - new Date(s.published_at).getTime() < WINDOW_MS;
	}

	async function load() {
		loading = true;
		try {
			stories = await listStories();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load stories');
		} finally {
			loading = false;
		}
	}

	async function handlePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const ok = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.type);
		if (!ok) {
			toast.error('Stories must be JPEG, PNG, WebP, or MP4');
			return;
		}
		uploading = true;
		try {
			await uploadStory(file);
			toast.success('Story published');
			await load();
			onChanged?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Story upload failed');
		} finally {
			uploading = false;
		}
	}

	async function remove(s: OwnedStory) {
		removing = s.local_id;
		try {
			await deleteStory(s.did, s.local_id);
			await load();
			onChanged?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete story');
		} finally {
			removing = null;
		}
	}

	onMount(load);
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div>
			<p class="text-sm font-medium">Stories</p>
			<p class="text-xs text-muted-foreground">Slides stay in your public reel for 24 hours.</p>
		</div>
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp,video/mp4"
			class="hidden"
			bind:this={fileInput}
			onchange={handlePick}
		/>
		<Button size="sm" variant="outline" disabled={uploading} onclick={() => fileInput?.click()}>
			{#if uploading}
				<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
			{:else}
				<Plus class="mr-1.5 h-3.5 w-3.5" />
			{/if}
			Add story
		</Button>
	</div>

	{#if loading}
		<div class="flex justify-center py-6">
			<Loader2 class="size-5 animate-spin text-muted-foreground" />
		</div>
	{:else if stories.length === 0}
		<p class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
			No stories yet. Add one to show it on your profile.
		</p>
	{:else}
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
			{#each stories as s (s.local_id)}
				<div
					class="group relative aspect-[9/16] overflow-hidden rounded-md border border-border bg-muted {isActive(
						s
					)
						? ''
						: 'opacity-50'}"
				>
					{#if s.url && s.mime_type.startsWith('image/')}
						<img src={proxied(s.url)} alt={s.filename} class="h-full w-full object-cover" />
					{:else if s.url && s.mime_type.startsWith('video/')}
						<video src={proxied(s.url)} class="h-full w-full object-cover" muted></video>
					{/if}
					{#if !isActive(s)}
						<span
							class="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-background/80 px-1 py-0.5 text-[9px] text-muted-foreground"
						>
							<Clock class="size-2.5" />
							{s.status === 'completed' ? 'expired' : s.status}
						</span>
					{/if}
					<button
						type="button"
						class="absolute right-1 top-1 rounded bg-background/80 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
						onclick={() => remove(s)}
						disabled={removing === s.local_id}
						aria-label="Delete story"
					>
						{#if removing === s.local_id}
							<Loader2 class="size-3 animate-spin" />
						{:else}
							<Trash2 class="size-3" />
						{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
