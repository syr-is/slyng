<script lang="ts">
	import * as Dialog from '@syren/ui/dialog';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import ImageField from './image-field.svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { CreateServerInputSchema } from '@syren/types';

	const {
		open,
		onClose,
		onCreate
	}: {
		open: boolean;
		onClose: () => void;
		onCreate: (data: {
			name: string;
			icon_url?: string;
			banner_url?: string;
			invite_background_url?: string;
			description?: string;
		}) => void;
	} = $props();

	// Generated `CreateServerInputSchema` covers the field shape; we
	// extend it with bounds (`name` 1–100 chars, `description` ≤ 1000)
	// that the Rust source can't express.
	const Schema = CreateServerInputSchema.extend({
		name: z.string().min(1, 'Server name is required').max(100),
		description: z.string().max(1000).optional(),
		icon_url: z.string().url().optional(),
		banner_url: z.string().url().optional(),
		invite_background_url: z.string().url().optional()
	});

	const form = superForm(defaults(zod4(Schema)), {
		SPA: true,
		validators: zod4Client(Schema),
		onUpdate: ({ form: f }) => {
			if (!f.valid) return;
			onCreate({
				name: f.data.name.trim(),
				icon_url: f.data.icon_url || undefined,
				banner_url: f.data.banner_url || undefined,
				invite_background_url: f.data.invite_background_url || undefined,
				description: f.data.description?.trim() || undefined
			});
			f.data = { name: '' };
			onClose();
		}
	});
	const { form: formData, enhance } = form;
</script>

<Dialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) {
			$formData = { name: '' };
			onClose();
		}
	}}
>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Create a Server</Dialog.Title>
			<Dialog.Description>
				Your server is where you and your friends hang out. Customize its look below.
			</Dialog.Description>
		</Dialog.Header>
		<form method="POST" use:enhance class="space-y-4 py-4">
			<Form.Field {form} name="name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Server Name</Form.Label>
						<Input {...props} bind:value={$formData.name} placeholder="My Server" />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="description">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Description</Form.Label>
						<Input
							{...props}
							bind:value={$formData.description}
							placeholder="What's this server about?"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<ImageField
				label="Icon"
				value={$formData.icon_url ?? null}
				onChange={(v) => ($formData.icon_url = v ?? undefined)}
				aspect="square"
			/>
			<ImageField
				label="Banner"
				value={$formData.banner_url ?? null}
				onChange={(v) => ($formData.banner_url = v ?? undefined)}
				aspect="banner"
			/>
			<ImageField
				label="Invite page background"
				value={$formData.invite_background_url ?? null}
				onChange={(v) => ($formData.invite_background_url = v ?? undefined)}
				aspect="wide"
			/>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={onClose}>Cancel</Button>
				<Form.Button>Create</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
