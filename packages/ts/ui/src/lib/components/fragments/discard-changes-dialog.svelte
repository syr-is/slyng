<script lang="ts">
	import * as Dialog from '@slyng/ui/dialog';
	import { Button } from '@slyng/ui/button';
	import { AlertTriangle } from '@lucide/svelte';

	/**
	 * Lightweight discard-changes confirm, interposed when an editor with
	 * unsaved work is about to close. Framing rules: the title names what
	 * is lost, the safe choice ("Keep editing") is the default focus, and
	 * the destructive choice always says "Discard changes" — never an
	 * ambiguous OK/Cancel pair. Escape / outside click count as "keep
	 * editing" (never silently discards).
	 */
	const {
		open,
		title,
		description,
		onKeepEditing,
		onDiscard
	}: {
		open: boolean;
		title: string;
		description: string;
		onKeepEditing: () => void;
		onDiscard: () => void;
	} = $props();
</script>

<Dialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) onKeepEditing();
	}}
>
	<Dialog.Content class="sm:max-w-md" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<AlertTriangle class="h-5 w-5 shrink-0 text-amber-500" />
				<span class="min-w-0 truncate">{title}</span>
			</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button variant="outline" onclick={onKeepEditing}>Keep editing</Button>
			<Button variant="destructive" onclick={onDiscard}>Discard changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
