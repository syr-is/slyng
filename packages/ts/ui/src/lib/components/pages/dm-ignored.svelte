<script lang="ts">
	import { onMount } from 'svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { EyeOff, Check, X, MessageSquare } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '@syren/app-core/api';
	import { getRelations } from '@syren/app-core/stores/relations.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { proxied } from '@syren/app-core/utils/proxy';

	const relations = getRelations();
	let dms = $state<
		Array<{
			id: string;
			type: string;
			other_user_id: string | null;
			other_user_instance_url?: string | null;
			is_ignored: boolean;
		}>
	>([]);

	async function refreshDms() {
		try {
			const list = await api.users.dmChannels();
			dms = list.filter((c) => c.is_ignored);
		} catch {
			/* best-effort */
		}
	}

	onMount(() => {
		void refreshDms();
	});

	// Incoming friend requests from ignored users — kept out of the main
	// Requests tab but still actionable here. User can accept + stay ignored.
	const ignoredIncoming = $derived(
		[...relations.incoming.entries()]
			.filter(([did]) => relations.isIgnored(did))
			.map(([did, meta]) => ({ did, created_at: meta.created_at }))
	);

	async function unignore(did: string) {
		try {
			await api.relations.unignore(did);
			toast.success('Unignored');
			void refreshDms();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	async function openDm(channelId: string) {
		goto(`/channels/@me/${channelId}`);
	}

	async function accept(did: string) {
		try {
			await api.relations.accept(did);
			toast.success('Friend added (still ignored)');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}

	async function decline(did: string) {
		try {
			await api.relations.decline(did);
			toast.success('Request declined');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		}
	}
</script>

<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
	<EyeOff class="h-4 w-4 text-muted-foreground" />
	<h1 class="text-sm font-semibold">Ignored</h1>
</div>

<main class="flex-1 overflow-y-auto">
	<div class="mx-auto max-w-3xl space-y-6 p-6">
		<p class="text-xs text-muted-foreground">
			Ignored users can still reach you; their DMs land here silently. Their friend requests
			appear below — accepting keeps them ignored.
		</p>

		<section>
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Ignored DMs · {dms.length}
			</h2>
			{#if dms.length === 0}
				<p class="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
					No DMs from ignored users.
				</p>
			{:else}
				<div class="space-y-1">
					{#each dms as c (c.id)}
						{@const did = c.other_user_id}
						{@const profile = did
							? resolveProfile(did, c.other_user_instance_url ?? relations.instanceFor(did))
							: null}
						{@const name = did && profile ? displayName(profile, did) : 'Direct Message'}
						<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
							<Avatar.Root class="h-9 w-9 shrink-0 opacity-70">
								{#if profile?.avatar_url}
									<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
								{/if}
								<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{name}</p>
								{#if did && profile}
									<p class="truncate font-mono text-[11px] text-muted-foreground">
										{federatedHandle(profile, did)}
									</p>
								{/if}
							</div>
							<button
								type="button"
								onclick={() => openDm(c.id)}
								title="Open conversation"
								class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								<MessageSquare class="h-4 w-4" />
							</button>
							{#if did}
								<button
									type="button"
									onclick={() => unignore(did)}
									title="Unignore"
									class="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									Unignore
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Friend requests from ignored users · {ignoredIncoming.length}
			</h2>
			{#if ignoredIncoming.length === 0}
				<p class="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
					Nothing pending.
				</p>
			{:else}
				<div class="space-y-1">
					{#each ignoredIncoming as r (r.did)}
						{@const profile = resolveProfile(r.did, relations.instanceFor(r.did))}
						{@const name = displayName(profile, r.did)}
						<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
							<Avatar.Root class="h-9 w-9 shrink-0 opacity-70">
								{#if profile.avatar_url}
									<Avatar.Image src={proxied(profile.avatar_url)} alt={name} />
								{/if}
								<Avatar.Fallback class="text-xs">{name.slice(0, 2).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{name}</p>
								<p class="truncate font-mono text-[11px] text-muted-foreground">
									{federatedHandle(profile, r.did)}
								</p>
							</div>
							<button
								type="button"
								onclick={() => accept(r.did)}
								title="Accept (stay ignored)"
								class="rounded p-1.5 text-green-500 hover:bg-green-500/15"
							>
								<Check class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => decline(r.did)}
								title="Decline"
								class="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</main>
