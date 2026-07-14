<script lang="ts">
	// Authoring shell for owned posts (P5). Handles both `/posts/new` and
	// `/posts/[did]/[id]/edit` (same component; route params via `$app/state`).
	// A draft row is created on mount for a new post so inline media uploads have
	// a post to hang under; Save/Publish patch it. Blog posts use the TipTap
	// <PostEditor> (Markdown body); media posts use an upload grid + display mode.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import {
		createPost,
		updatePost,
		getOwnPost,
		uploadPostAsset,
		type OwnedPost
	} from '@syren/app-core/upload/idp-post';
	import { proxied } from '@syren/app-core/utils/proxy';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { ArrowLeft, LoaderCircle, Eye, Pencil, ImagePlus, X, FileText, Images } from '@lucide/svelte';
	import PostEditor from '../fragments/post-editor/post-editor.svelte';

	const auth = getAuth();

	const editDid = $derived(page.params.did ? decodeURIComponent(page.params.did) : null);
	const editId = $derived(page.params.id ? decodeURIComponent(page.params.id) : null);
	const isEdit = $derived(!!(editDid && editId));

	let loading = $state(true);
	let saving = $state(false);
	let uploadingMedia = $state(false);
	let did = $state('');
	let localId = $state('');
	let type = $state<'blog' | 'media'>('blog');
	let title = $state('');
	let description = $state('');
	let visibility = $state<'public' | 'unlisted' | 'private'>('public');
	let content = $state(''); // markdown (blog) — the initial value loaded into the editor
	let mediaUrls = $state<string[]>([]);
	let displayMode = $state<'gallery' | 'masonry' | 'carousel' | 'cards'>('gallery');
	let status = $state<'draft' | 'completed'>('draft');
	let previewMode = $state(false);
	// Latest markdown from the editor's onChange. NOT $state — it must not feed
	// back into the editor's `content` prop (that would loop).
	let editorContent = '';
	let mediaInput = $state<HTMLInputElement | null>(null);

	function applyPost(p: OwnedPost): void {
		did = p.did;
		localId = p.local_id;
		type = p.type;
		title = p.title ?? '';
		description = p.description ?? '';
		visibility = p.visibility;
		content = p.content ?? '';
		editorContent = p.content ?? '';
		mediaUrls = p.media_urls ?? [];
		displayMode = (p.display_mode as typeof displayMode) ?? 'gallery';
		status = p.status;
	}

	onMount(async () => {
		if (!auth.identity?.did) {
			toast.error('Sign in with a local account to write posts.');
			loading = false;
			return;
		}
		try {
			if (isEdit) {
				applyPost(await getOwnPost(editDid!, editId!));
			} else {
				const p = await createPost({
					type: 'blog',
					content_type: 'markdown',
					status: 'draft',
					visibility: 'public'
				});
				applyPost(p);
				// Point the URL at the draft so a refresh reloads it (no new draft).
				replaceState(
					`/posts/${encodeURIComponent(p.did)}/${encodeURIComponent(p.local_id)}/edit`,
					{}
				);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to load the post.');
		}
		loading = false;
	});

	async function save(publish: boolean): Promise<void> {
		if (!localId || saving) return;
		saving = true;
		try {
			const patch: Record<string, unknown> = {
				type,
				title,
				description,
				visibility,
				status: publish ? 'completed' : 'draft'
			};
			if (type === 'blog') {
				patch.content_type = 'markdown';
				patch.content = editorContent;
			} else {
				patch.media_urls = mediaUrls;
				patch.display_mode = displayMode;
			}
			const p = await updatePost(did, localId, patch);
			applyPost(p);
			toast.success(publish ? 'Post published.' : 'Draft saved.');
			if (publish) goto(`/p/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't save the post.");
		} finally {
			saving = false;
		}
	}

	async function onMediaPicked(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length || !localId) return;
		uploadingMedia = true;
		try {
			for (const file of files) {
				const url = await uploadPostAsset(localId, file);
				mediaUrls = [...mediaUrls, url];
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't upload media.");
		} finally {
			uploadingMedia = false;
		}
	}

	function removeMedia(url: string): void {
		mediaUrls = mediaUrls.filter((u) => u !== url);
	}

	// Leave the composer → the author's posts feed (its parent). Deterministic
	// even on a deep-load, since the composer replaceState's its own URL and
	// `history.back()` could otherwise exit the app.
	function goBack(): void {
		if (did) goto(`/channels/@me/posts/${encodeURIComponent(did)}`);
		else history.back();
	}

	function isVideo(url: string): boolean {
		return /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url);
	}
</script>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4">
	{#if loading}
		<div class="flex flex-1 items-center justify-center text-muted-foreground">
			<LoaderCircle class="size-6 animate-spin" />
		</div>
	{:else if !localId}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
			<p>Posts can only be authored on a local account hosted by this instance.</p>
			<Button variant="outline" size="sm" onclick={() => goto('/channels/@me')}>
				<ArrowLeft class="mr-1 size-4" /> Back
			</Button>
		</div>
	{:else}
		<!-- Header: back + type toggle + status + actions -->
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" onclick={goBack} title="Back to posts" aria-label="Back to posts">
				<ArrowLeft class="size-4" />
			</Button>
			<div class="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Post type">
				<button
					type="button"
					class="flex items-center gap-1.5 px-3 py-1.5 text-sm {type === 'blog'
						? 'bg-primary text-primary-foreground'
						: 'bg-background text-muted-foreground hover:bg-muted'}"
					onclick={() => (type = 'blog')}
				>
					<FileText class="size-4" /> Blog
				</button>
				<button
					type="button"
					class="flex items-center gap-1.5 px-3 py-1.5 text-sm {type === 'media'
						? 'bg-primary text-primary-foreground'
						: 'bg-background text-muted-foreground hover:bg-muted'}"
					onclick={() => (type = 'media')}
				>
					<Images class="size-4" /> Media
				</button>
			</div>

			<span
				class="rounded-full border px-2 py-0.5 text-xs {status === 'completed'
					? 'border-primary/40 text-primary'
					: 'text-muted-foreground'}"
			>
				{status === 'completed' ? 'Published' : 'Draft'}
			</span>

			<div class="ml-auto flex items-center gap-2">
				<select
					bind:value={visibility}
					class="h-9 rounded-md border bg-background px-2 text-sm"
					aria-label="Visibility"
				>
					<option value="public">Public</option>
					<option value="unlisted">Unlisted</option>
					<option value="private">Private</option>
				</select>
				<Button variant="outline" size="sm" disabled={saving} onclick={() => save(false)}>
					{#if saving}<LoaderCircle class="mr-1 size-4 animate-spin" />{/if}
					Save draft
				</Button>
				<Button size="sm" disabled={saving} onclick={() => save(true)}>
					{status === 'completed' ? 'Update' : 'Publish'}
				</Button>
			</div>
		</div>

		<!-- Title + description -->
		<Input bind:value={title} placeholder="Title" class="text-lg font-semibold" />
		<Input bind:value={description} placeholder="Short description (optional)" />

		{#if type === 'blog'}
			<!-- Blog body: TipTap editor with a Preview/Edit toggle -->
			<div class="flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-md border">
				<PostEditor
					{content}
					editable={!previewMode}
					postId={localId}
					onChange={(md) => (editorContent = md)}
				>
					{#snippet toolbarEnd()}
						<button
							type="button"
							class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							onclick={() => (previewMode = !previewMode)}
						>
							{#if previewMode}
								<Pencil class="size-3.5" /> Edit
							{:else}
								<Eye class="size-3.5" /> Preview
							{/if}
						</button>
					{/snippet}
				</PostEditor>
			</div>
		{:else}
			<!-- Media post: upload grid + display mode -->
			<div class="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={uploadingMedia}
					onclick={() => mediaInput?.click()}
				>
					{#if uploadingMedia}
						<LoaderCircle class="mr-1 size-4 animate-spin" />
					{:else}
						<ImagePlus class="mr-1 size-4" />
					{/if}
					Add media
				</Button>
				<select
					bind:value={displayMode}
					class="h-9 rounded-md border bg-background px-2 text-sm"
					aria-label="Display mode"
				>
					<option value="gallery">Gallery</option>
					<option value="masonry">Masonry</option>
					<option value="carousel">Carousel</option>
					<option value="cards">Cards</option>
				</select>
				<input
					bind:this={mediaInput}
					type="file"
					accept="image/*,video/*"
					multiple
					class="hidden"
					onchange={onMediaPicked}
				/>
			</div>

			{#if mediaUrls.length}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each mediaUrls as url (url)}
						<div class="group relative overflow-hidden rounded-md border bg-muted">
							{#if isVideo(url)}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video src={proxied(url)} class="h-32 w-full object-cover" muted></video>
							{:else}
								<img src={proxied(url)} alt="" class="h-32 w-full object-cover" loading="lazy" />
							{/if}
							<button
								type="button"
								class="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
								aria-label="Remove"
								onclick={() => removeMedia(url)}
							>
								<X class="size-4" />
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<div
					class="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
				>
					No media yet — add images or video.
				</div>
			{/if}
		{/if}
	{/if}
</div>
