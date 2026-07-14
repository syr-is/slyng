<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import * as Dialog from '@slyng/ui/dialog';
	import { Loader2, Download, Upload, KeyRound } from '@lucide/svelte';
	import {
		exportIdentity,
		importIdentity
	} from '@slyng/app-core/upload/identity-migration';
	import type { IdentityImportResult } from '@slyng/types';

	/**
	 * Identity import / export (P11). Export downloads a root-signed `.zip` of
	 * all your hosted content (password-gated). Import restores/merges such a
	 * bundle back into this account — same DID only, verified end-to-end.
	 */

	let exportOpen = $state(false);
	let password = $state('');
	let exporting = $state(false);

	let fileInput: HTMLInputElement | undefined = $state();
	let importing = $state(false);
	let lastImport = $state<IdentityImportResult['imported'] | null>(null);

	async function doExport() {
		if (!password || exporting) return;
		exporting = true;
		try {
			await exportIdentity(password);
			password = '';
			exportOpen = false;
			toast.success('Export downloaded.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Export failed');
		}
		exporting = false;
	}

	async function doImport(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || importing) return;
		importing = true;
		lastImport = null;
		try {
			const res = await importIdentity(file);
			lastImport = res.imported;
			const total =
				res.imported.posts +
				res.imported.stories +
				res.imported.uploads +
				res.imported.emojis +
				res.imported.gifs +
				res.imported.comments +
				res.imported.reactions +
				res.imported.follows;
			toast.success(`Imported ${total} records + ${res.imported.assets} assets.`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed');
		}
		importing = false;
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-semibold">Identity</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Back up or move your whole identity — profile, posts, stories, emoji, GIFs, and files — as a
			single signed archive. The bundle is signed with your identity key, so any instance can verify
			it came from you.
		</p>
	</div>

	<!-- Export -->
	<div class="rounded-md border border-border p-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Export identity</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Download a signed <code class="text-xs">.zip</code> of everything you host here, including
					your encrypted key so you can restore login elsewhere.
				</p>
			</div>
			<Button size="sm" onclick={() => (exportOpen = true)}>
				<Download class="mr-1.5 size-4" /> Export
			</Button>
		</div>
	</div>

	<!-- Import -->
	<div class="rounded-md border border-border p-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Import / restore</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Restore a bundle you exported from this identity. Records are merged; existing ones are
					updated. Only a bundle for <b>this</b> DID is accepted.
				</p>
			</div>
			<Button size="sm" variant="outline" disabled={importing} onclick={() => fileInput?.click()}>
				{#if importing}<Loader2 class="mr-1.5 size-4 animate-spin" />{:else}<Upload class="mr-1.5 size-4" />{/if}
				Import
			</Button>
		</div>
		{#if lastImport}
			<p class="mt-3 text-xs text-muted-foreground">
				Last import: {lastImport.posts} posts · {lastImport.stories} stories · {lastImport.emojis} emoji
				· {lastImport.gifs} GIFs · {lastImport.uploads} files · {lastImport.assets} assets.
			</p>
		{/if}
	</div>

	<input
		type="file"
		accept=".zip,application/zip"
		class="hidden"
		bind:this={fileInput}
		onchange={doImport}
	/>
</div>

<!-- Export password prompt -->
<Dialog.Root bind:open={exportOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Export identity</Dialog.Title>
			<Dialog.Description>
				Your password unlocks your identity key to sign the export. It is used once and never
				stored.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-3"
			onsubmit={(e) => {
				e.preventDefault();
				void doExport();
			}}
		>
			<div class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
				<KeyRound class="size-4 text-muted-foreground" />
				<input
					type="password"
					bind:value={password}
					placeholder="Account password"
					autocomplete="current-password"
					class="flex-1 bg-transparent text-sm focus:outline-none"
				/>
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={() => (exportOpen = false)}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={exporting || !password}>
					{#if exporting}<Loader2 class="mr-1.5 size-4 animate-spin" />{/if}
					Download
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
