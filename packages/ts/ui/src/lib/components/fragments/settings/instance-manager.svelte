<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { Loader2, Save, HardDrive, FileUp } from '@lucide/svelte';
	import {
		getInstance,
		loadInstanceLimits,
		saveInstanceLimits
	} from '@slyng/app-core/stores/instance.svelte';

	/**
	 * Instance admin control surface. Sets the two platform-wide upload limits:
	 * the per-file size cap (enforced on every upload across the platform) and
	 * the per-account storage quota (the file library). Visible only to instance
	 * admins (the settings page gates the tab on `is_admin`); the PATCH is
	 * admin-guarded server-side regardless.
	 */
	const instance = getInstance();

	let maxFileMb = $state('');
	let storageGb = $state('');
	let loading = $state(true);
	let saving = $state(false);

	function hydrate() {
		const l = instance.limits;
		if (l) {
			maxFileMb = String(l.max_file_size_mb);
			storageGb = String(l.storage_limit_gb);
		}
	}

	onMount(async () => {
		await loadInstanceLimits();
		hydrate();
		loading = false;
	});

	const maxFileNum = $derived(Number(maxFileMb));
	const storageNum = $derived(Number(storageGb));
	const maxFileValid = $derived(Number.isInteger(maxFileNum) && maxFileNum >= 1 && maxFileNum <= 4096);
	const storageValid = $derived(Number.isFinite(storageNum) && storageNum >= 0.1 && storageNum <= 10000);
	const dirty = $derived(
		!!instance.limits &&
			(maxFileNum !== instance.limits.max_file_size_mb ||
				storageNum !== instance.limits.storage_limit_gb)
	);

	async function save() {
		if (!maxFileValid || !storageValid || !dirty) return;
		saving = true;
		try {
			await saveInstanceLimits({ max_file_size_mb: maxFileNum, storage_limit_gb: storageNum });
			hydrate();
			toast.success('Instance limits updated');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update limits');
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-5">
	<div>
		<p class="text-sm font-medium">Instance limits</p>
		<p class="text-xs text-muted-foreground">
			Platform-wide upload limits. Changes apply to every new upload across this instance.
		</p>
	</div>

	{#if loading}
		<div class="flex justify-center py-8"><Loader2 class="size-5 animate-spin text-muted-foreground" /></div>
	{:else}
		<div class="space-y-4">
			<!-- Per-file cap -->
			<div class="rounded-md border border-border bg-muted/30 p-3">
				<label for="max-file" class="flex items-center gap-1.5 text-sm font-medium">
					<FileUp class="size-4 text-muted-foreground" /> Max file size
				</label>
				<p class="mt-0.5 mb-2 text-xs text-muted-foreground">
					Hard cap on any single file — chat attachments, library files, stories, posts, and profile images.
				</p>
				<div class="flex items-center gap-2">
					<Input
						id="max-file"
						type="number"
						min="1"
						max="4096"
						bind:value={maxFileMb}
						class="h-9 w-32"
						aria-invalid={maxFileMb.length > 0 && !maxFileValid}
					/>
					<span class="text-sm text-muted-foreground">MB</span>
				</div>
				{#if maxFileMb.length > 0 && !maxFileValid}
					<p class="mt-1 text-xs text-destructive">Enter a whole number between 1 and 4096.</p>
				{/if}
			</div>

			<!-- Per-account storage quota -->
			<div class="rounded-md border border-border bg-muted/30 p-3">
				<label for="storage" class="flex items-center gap-1.5 text-sm font-medium">
					<HardDrive class="size-4 text-muted-foreground" /> Per-account storage quota
				</label>
				<p class="mt-0.5 mb-2 text-xs text-muted-foreground">
					Total library storage each account may use before uploads are blocked.
				</p>
				<div class="flex items-center gap-2">
					<Input
						id="storage"
						type="number"
						min="0.1"
						step="0.1"
						max="10000"
						bind:value={storageGb}
						class="h-9 w-32"
						aria-invalid={storageGb.length > 0 && !storageValid}
					/>
					<span class="text-sm text-muted-foreground">GB</span>
				</div>
				{#if storageGb.length > 0 && !storageValid}
					<p class="mt-1 text-xs text-destructive">Enter a value between 0.1 and 10000.</p>
				{/if}
			</div>

			<Button size="sm" class="gap-1.5" disabled={!dirty || !maxFileValid || !storageValid || saving} onclick={save}>
				{#if saving}<Loader2 class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}
				Save changes
			</Button>
		</div>
	{/if}
</div>
