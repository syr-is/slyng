<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import * as Dialog from '@slyng/ui/dialog';
	import {
		Loader2,
		Download,
		Upload,
		KeyRound,
		ShieldCheck,
		ShieldAlert,
		TriangleAlert
	} from '@lucide/svelte';
	import {
		exportIdentity,
		getExportInfo,
		importIdentity
	} from '@slyng/app-core/upload/identity-migration';
	import type { IdentityImportResult } from '@slyng/types';

	/**
	 * Identity import / export (P11). Export downloads an archive of all your
	 * hosted content. A custodial (password) account signs the bundle with its
	 * root key (password-gated); a self-custody account gets an explicit unsigned,
	 * data-only bundle (the root seed lives on your device). Import restores/merges
	 * such a bundle back into this account — same DID only, verified end-to-end,
	 * with legacy (v1) and unsigned bundles clearly flagged.
	 */

	// Custody decides whether export needs a password. `null` while loading;
	// default to requiring a password until we know, so we never skip signing.
	let hasAegis = $state<boolean | null>(null);

	let exportOpen = $state(false);
	let password = $state('');
	let exporting = $state(false);

	let fileInput: HTMLInputElement | undefined = $state();
	let importing = $state(false);
	let lastImport = $state<IdentityImportResult | null>(null);

	onMount(async () => {
		try {
			hasAegis = (await getExportInfo()).has_aegis;
		} catch {
			// Leave `null` → the export button falls back to the password dialog.
		}
	});

	function startExport() {
		if (hasAegis === false) {
			// Self-custody: nothing to unlock — export the unsigned data-only bundle.
			void doExport();
		} else {
			exportOpen = true;
		}
	}

	async function doExport() {
		if (exporting) return;
		// A custodial export needs the password; a self-custody one must not send it.
		const usePassword = hasAegis !== false;
		if (usePassword && !password) return;
		exporting = true;
		try {
			await exportIdentity(usePassword ? password : undefined);
			password = '';
			exportOpen = false;
			toast.success(usePassword ? 'Signed export downloaded.' : 'Unsigned data-only export downloaded.');
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
			lastImport = res;
			const c = res.imported;
			const total =
				c.posts + c.stories + c.uploads + c.emojis + c.gifs + c.comments + c.reactions + c.follows;
			if (res.verification === 'legacy-unverified') {
				toast.warning(`Imported ${total} records — legacy bundle, authenticity not verifiable.`);
			} else if (res.verification === 'unsigned') {
				toast.success(`Imported ${total} records + ${c.assets} assets (unsigned bundle).`);
			} else {
				toast.success(`Imported ${total} records + ${c.assets} assets. Signature verified.`);
			}
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
			single archive. A custodial account signs the bundle with your identity key, so any instance
			can verify it came from you.
		</p>
	</div>

	<!-- Export -->
	<div class="rounded-md border border-border p-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Export identity</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{#if hasAegis === false}
						Download a <code class="text-xs">.zip</code> of everything you host here. Your root key
						lives on your device, so this bundle is <b>unsigned and data-only</b> — restore it into a
						signed-in session on any instance.
					{:else}
						Download a signed <code class="text-xs">.zip</code> of everything you host here, including
						your encrypted key so you can restore login elsewhere.
					{/if}
				</p>
			</div>
			<Button size="sm" disabled={exporting || hasAegis === null} onclick={startExport}>
				{#if exporting || hasAegis === null}<Loader2 class="mr-1.5 size-4 animate-spin" />{:else}<Download class="mr-1.5 size-4" />{/if}
				Export
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
			{@const c = lastImport.imported}
			{#if lastImport.verification === 'legacy-unverified'}
				<div class="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
					<TriangleAlert class="mt-0.5 size-4 shrink-0" />
					<span>
						<b>Legacy unsigned bundle — authenticity not verifiable.</b> This is an older (v1) export.
						Its contents were imported and integrity-checked, but there is no signature this instance
						can verify against your identity key. Re-export from an up-to-date instance for a signed bundle.
					</span>
				</div>
			{:else if lastImport.verification === 'unsigned'}
				<div class="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
					<ShieldAlert class="mt-0.5 size-4 shrink-0" />
					<span>
						<b>Unsigned self-custody bundle.</b> Contents were integrity-checked; authenticity rests
						on your signed-in session (the signing key is on your device, not here).
					</span>
				</div>
			{:else}
				<div class="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
					<ShieldCheck class="mt-0.5 size-4 shrink-0" />
					<span><b>Signature verified.</b> The bundle is authentic to your identity key.</span>
				</div>
			{/if}
			<p class="mt-2 text-xs text-muted-foreground">
				Imported: {c.posts} posts · {c.stories} stories · {c.emojis} emoji · {c.gifs} GIFs · {c.uploads}
				files · {c.assets} assets.
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

<!-- Export password prompt (custodial accounts only) -->
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
