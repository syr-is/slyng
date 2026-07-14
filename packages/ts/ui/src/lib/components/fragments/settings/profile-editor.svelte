<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Label } from '@syren/ui/label';
	import * as Avatar from '@syren/ui/avatar';
	import { Loader2, Save, Upload, ImageIcon } from '@lucide/svelte';
	import { proxied } from '@syren/app-core/utils/proxy';
	import {
		isLocalIdentity,
		getLocalProfile,
		updateProfile,
		uploadProfileAsset
	} from '@syren/app-core/upload/idp-upload';
	import StoryComposer from './story-composer.svelte';

	/**
	 * In-app profile editor for accounts hosted on this syren instance.
	 * Self-gates: renders only when the identity is local (`isLocalIdentity`).
	 * For federated identities it renders nothing — the parent keeps showing
	 * the read-only card + "Edit on syr".
	 */
	const {
		did,
		instanceUrl,
		onUpdated
	}: { did: string; instanceUrl: string | undefined; onUpdated?: () => void } = $props();

	let isLocal = $state(false);
	let ready = $state(false);
	let saving = $state(false);
	let uploadingAvatar = $state(false);
	let uploadingBanner = $state(false);

	let displayName = $state('');
	let bio = $state('');
	let avatarUrl = $state<string | null>(null);
	let bannerUrl = $state<string | null>(null);

	let avatarInput: HTMLInputElement | undefined = $state();
	let bannerInput: HTMLInputElement | undefined = $state();

	const initials = $derived((displayName || '?').slice(0, 2).toUpperCase());

	onMount(async () => {
		isLocal = await isLocalIdentity(instanceUrl);
		if (isLocal) {
			try {
				const p = await getLocalProfile(did);
				displayName = p.display_name ?? '';
				bio = p.bio ?? '';
				avatarUrl = p.avatar_url ?? null;
				bannerUrl = p.banner_url ?? null;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Failed to load profile');
			}
		}
		ready = true;
	});

	async function pickAsset(kind: 'avatar' | 'banner', e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			toast.error('Pick an image file');
			return;
		}
		if (kind === 'avatar') uploadingAvatar = true;
		else uploadingBanner = true;
		try {
			const url = await uploadProfileAsset(kind, file);
			if (kind === 'avatar') avatarUrl = url;
			else bannerUrl = url;
			// Persist immediately so the asset survives a page reload even if the
			// user doesn't hit Save afterwards.
			await updateProfile({ [`${kind}_url`]: url });
			onUpdated?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			uploadingAvatar = false;
			uploadingBanner = false;
		}
	}

	async function save() {
		if (!displayName.trim()) {
			toast.error('Display name is required');
			return;
		}
		saving = true;
		try {
			await updateProfile({ display_name: displayName.trim(), bio: bio.trim() });
			toast.success('Profile saved');
			onUpdated?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save profile');
		} finally {
			saving = false;
		}
	}
</script>

{#if !ready}
	<div class="flex justify-center py-8">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else if isLocal}
	<div class="space-y-5">
		<p class="text-sm text-muted-foreground">
			Edits publish to your profile and federate to anyone following you.
		</p>

		<!-- Banner -->
		<div class="space-y-2">
			<Label>Banner</Label>
			<div class="relative aspect-[5/1] w-full overflow-hidden rounded-md border border-border bg-muted">
				{#if uploadingBanner}
					<div class="flex h-full w-full items-center justify-center">
						<Loader2 class="size-5 animate-spin text-muted-foreground" />
					</div>
				{:else if bannerUrl}
					<img src={proxied(bannerUrl)} alt="Banner" class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center text-muted-foreground/50">
						<ImageIcon class="size-6" />
					</div>
				{/if}
			</div>
			<input type="file" accept="image/*" class="hidden" bind:this={bannerInput} onchange={(e) => pickAsset('banner', e)} />
			<Button size="sm" variant="outline" disabled={uploadingBanner} onclick={() => bannerInput?.click()}>
				<Upload class="mr-1.5 size-3.5" /> Change banner
			</Button>
		</div>

		<!-- Avatar -->
		<div class="space-y-2">
			<Label>Avatar</Label>
			<div class="flex items-center gap-3">
				<Avatar.Root class="size-16 border border-border">
					{#if avatarUrl}
						<Avatar.Image src={proxied(avatarUrl)} alt="Avatar" />
					{/if}
					<Avatar.Fallback>{initials}</Avatar.Fallback>
				</Avatar.Root>
				<input type="file" accept="image/*" class="hidden" bind:this={avatarInput} onchange={(e) => pickAsset('avatar', e)} />
				<Button size="sm" variant="outline" disabled={uploadingAvatar} onclick={() => avatarInput?.click()}>
					{#if uploadingAvatar}
						<Loader2 class="mr-1.5 size-3.5 animate-spin" />
					{:else}
						<Upload class="mr-1.5 size-3.5" />
					{/if}
					Change avatar
				</Button>
			</div>
		</div>

		<!-- Display name -->
		<div class="space-y-2">
			<Label for="pe-display-name">Display name</Label>
			<Input id="pe-display-name" bind:value={displayName} maxlength={100} placeholder="Your name" />
		</div>

		<!-- Bio -->
		<div class="space-y-2">
			<Label for="pe-bio">Bio</Label>
			<textarea
				id="pe-bio"
				bind:value={bio}
				maxlength={500}
				rows={3}
				placeholder="Tell people about yourself"
				class="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			></textarea>
			<p class="text-right text-[11px] text-muted-foreground">{bio.length}/500</p>
		</div>

		<Button onclick={save} disabled={saving}>
			{#if saving}<Loader2 class="mr-2 size-4 animate-spin" />{:else}<Save class="mr-2 size-4" />{/if}
			Save profile
		</Button>

		<div class="border-t border-border pt-5">
			<StoryComposer onChanged={onUpdated} />
		</div>
	</div>
{/if}
