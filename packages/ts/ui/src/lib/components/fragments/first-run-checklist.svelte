<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, ChevronRight, X } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '@slyng/ui/button';
	import { Input } from '@slyng/ui/input';
	import { Progress } from '@slyng/ui/progress';
	import * as Dialog from '@slyng/ui/dialog';
	import CreateServerDialog from './create-server-dialog.svelte';
	import { WsOp } from '@slyng/types';
	import { api } from '@slyng/app-core/api';
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { getServerState, setServers } from '@slyng/app-core/stores/servers.svelte';
	import { resolveProfile } from '@slyng/app-core/stores/profiles.svelte';
	import { onWsEvent } from '@slyng/app-core/stores/ws.svelte';

	const { onStartConversation }: { onStartConversation: () => void } = $props();

	const auth = getAuth();
	const serverState = getServerState();

	// ── Persistence ──
	// One localStorage flag per identity: 'dismissed' (user closed it) or
	// 'complete' (every item auto-checked at least once). Either value hides
	// the checklist forever for that DID on this device.
	const storageKey = $derived(auth.identity?.did ? `slyng:first-run:${auth.identity.did}` : null);
	let persistedFlag = $state<string | null>(null);

	$effect(() => {
		if (!storageKey) return;
		try {
			persistedFlag = localStorage.getItem(storageKey);
		} catch {
			persistedFlag = null;
		}
	});

	function persist(value: 'dismissed' | 'complete') {
		persistedFlag = value;
		if (!storageKey) return;
		try {
			localStorage.setItem(storageKey, value);
		} catch {
			// Storage unavailable (private mode / quota) — the in-memory flag
			// still hides the card for this session.
		}
	}

	// ── Auto-check state ──
	// "Set up your profile": resolved live from the user's own syr instance —
	// slyng stores no profile data, so this reads the same reactive cache the
	// rest of the app uses.
	const ownProfile = $derived(
		auth.identity ? resolveProfile(auth.identity.did, auth.identity.syr_instance_url) : null
	);
	const profileDone = $derived(!!ownProfile?.display_name);

	// "Start a conversation": actual DM-channel count. Loaded once on mount and
	// kept live via DM_CHANNEL_CREATE. A failed fetch leaves the count unknown
	// (item stays unchecked, completion is never persisted from guesswork);
	// dm-layout fetches the same endpoint alongside this card and already
	// surfaces that failure as a toast, so we don't double-toast here.
	let dmCount = $state<number | null>(null);
	let dmLoaded = $state(false);

	async function refreshDmCount() {
		try {
			dmCount = (await api.users.dmChannels()).length;
		} catch {
			dmCount = null;
		}
		dmLoaded = true;
	}

	onMount(() => {
		void refreshDmCount();
		const unsub = onWsEvent(WsOp.DM_CHANNEL_CREATE, () => void refreshDmCount());
		return unsub;
	});

	// ── Items ──
	// First item is always pre-completed: the user already chose an instance
	// and created a DID-backed identity to get here. Crediting that work is
	// the goal-gradient head start — the bar never renders empty.
	let showJoinCreate = $state(false);

	const items = $derived([
		{
			id: 'identity',
			label: 'Identity created',
			description: 'Your DID is live on your syr instance',
			done: true,
			action: null as (() => void) | null
		},
		{
			id: 'server',
			label: 'Join or create a server',
			description: 'Use an invite code or start your own',
			done: serverState.servers.length > 0,
			action: () => (showJoinCreate = true)
		},
		{
			id: 'profile',
			label: 'Set up your profile',
			description: 'Pick a display name and avatar',
			done: profileDone,
			action: () => goto('/settings')
		},
		{
			id: 'dm',
			label: 'Start a conversation',
			description: 'Find someone by handle or DID',
			done: (dmCount ?? 0) > 0,
			action: onStartConversation
		}
	]);

	const doneCount = $derived(items.filter((i) => i.done).length);
	const percent = $derived(Math.round((doneCount / items.length) * 100));
	const allDone = $derived(doneCount === items.length);

	// Persist completion only once the DM count is real data — never off the
	// back of a failed fetch.
	$effect(() => {
		if (allDone && dmCount !== null && !persistedFlag) persist('complete');
	});

	// Hold rendering until the DM fetch settles so returning users whose flag
	// flips to 'complete' in the effect above never see the card flash in.
	const visible = $derived(dmLoaded && !persistedFlag);

	// ── Join / create a server ──
	let inviteInput = $state('');

	/** Accepts a bare invite code or a full invite link (…/invite/<code>). */
	function parseInviteCode(raw: string): string | null {
		const t = raw.trim();
		if (!t) return null;
		const fromUrl = t.match(/invite\/([A-Za-z0-9_-]+)/);
		if (fromUrl) return fromUrl[1];
		if (/^[A-Za-z0-9_-]+$/.test(t)) return t;
		return null;
	}

	function joinWithInvite(e: SubmitEvent) {
		e.preventDefault();
		const code = parseInviteCode(inviteInput);
		if (!code) {
			toast.error('Enter a valid invite code or link');
			return;
		}
		showJoinCreate = false;
		inviteInput = '';
		goto(`/invite/${encodeURIComponent(code)}`);
	}

	let showCreateServer = $state(false);

	async function handleCreateServer(data: {
		name: string;
		icon_url?: string;
		banner_url?: string;
		invite_background_url?: string;
		description?: string;
	}) {
		try {
			const created = await api.servers.create(data);
			const servers = await api.servers.list();
			setServers(servers);
			goto(`/channels/${encodeURIComponent(String(created.id))}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create server');
		}
	}
</script>

{#if visible}
	<section
		aria-label="Getting started checklist"
		class="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-sm"
	>
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold text-foreground">Welcome to Slyng</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{doneCount} of {items.length} done — you're already on your way.
				</p>
			</div>
			<button
				type="button"
				onclick={() => persist('dismissed')}
				aria-label="Dismiss getting-started checklist"
				class="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<Progress value={percent} class="mt-3 h-1.5" />

		<ul class="mt-3 space-y-1">
			{#each items as item (item.id)}
				<li>
					{#if item.done || !item.action}
						<div class="flex items-center gap-3 rounded-md px-2 py-1.5">
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
							>
								<Check class="h-3 w-3" />
							</span>
							<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
								{item.label}
							</span>
						</div>
					{:else}
						<button
							type="button"
							onclick={item.action}
							class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
						>
							<span class="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/40"
							></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-foreground">{item.label}</span>
								<span class="block truncate text-xs text-muted-foreground">{item.description}</span>
							</span>
							<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<Dialog.Root
		open={showJoinCreate}
		onOpenChange={(v) => {
			if (!v) showJoinCreate = false;
		}}
	>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Join or create a server</Dialog.Title>
				<Dialog.Description>
					Paste an invite link or code from a friend, or start a server of your own.
				</Dialog.Description>
			</Dialog.Header>
			<form onsubmit={joinWithInvite} class="space-y-4 py-2">
				<div class="flex gap-2">
					<Input
						bind:value={inviteInput}
						placeholder="Invite code or link"
						class="flex-1 font-mono text-sm"
						aria-label="Invite code or link"
					/>
					<Button type="submit" variant="outline">Join</Button>
				</div>
			</form>
			<div class="flex items-center gap-3">
				<div class="h-px flex-1 bg-border"></div>
				<span class="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
				<div class="h-px flex-1 bg-border"></div>
			</div>
			<Button
				class="mt-2 w-full"
				onclick={() => {
					showJoinCreate = false;
					showCreateServer = true;
				}}
			>
				Create a server
			</Button>
		</Dialog.Content>
	</Dialog.Root>

	<CreateServerDialog
		open={showCreateServer}
		onClose={() => (showCreateServer = false)}
		onCreate={handleCreateServer}
	/>
{/if}
