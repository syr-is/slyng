<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { CreateChannelInputSchema } from '@syren/types';

	const {
		open,
		onClose,
		onCreate
	}: {
		open: boolean;
		onClose: () => void;
		onCreate: (name: string, type: string) => void;
	} = $props();

	// Generated `CreateChannelInputSchema` covers `{ name, type?, category_id? }`.
	// Layer a `name.min(1).max(100)` constraint on top of the generated
	// shape — Rust models the field as `String` (no length cap), and a
	// 100-char ceiling matches the Server / Channel name caps used
	// elsewhere in the codebase.
	const Schema = CreateChannelInputSchema.extend({
		name: z.string().min(1, 'Channel name is required').max(100),
		type: z.enum(['text', 'voice']).default('text')
	});

	const form = superForm(defaults({ type: 'text' as const }, zod4(Schema)), {
		SPA: true,
		validators: zod4Client(Schema),
		onUpdate: ({ form: f }) => {
			if (!f.valid) return;
			onCreate(f.data.name.trim(), f.data.type);
			f.data.name = '';
			f.data.type = 'text';
			onClose();
		}
	});
	const { form: formData, enhance } = form;
</script>

<Dialog.Root {open} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Channel</Dialog.Title>
		</Dialog.Header>
		<form method="POST" use:enhance class="space-y-4 py-4">
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => ($formData.type = 'text')}
					class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors
						{$formData.type === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}"
				>
					# Text
				</button>
				<button
					type="button"
					onclick={() => ($formData.type = 'voice')}
					class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors
						{$formData.type === 'voice' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}"
				>
					🔊 Voice
				</button>
			</div>
			<Form.Field {form} name="name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Channel Name</Form.Label>
						<Input
							{...props}
							bind:value={$formData.name}
							placeholder={$formData.type === 'text' ? 'general' : 'voice-chat'}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={onClose}>Cancel</Button>
				<Form.Button>Create</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
