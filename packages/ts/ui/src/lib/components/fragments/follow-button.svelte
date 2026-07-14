<script lang="ts">
	import { Button } from '@slyng/ui/button';
	import { UserPlus, UserCheck, LoaderCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { getFollows, checkFollow, follow, unfollow } from '@slyng/app-core/stores/follows.svelte';

	/**
	 * Follow / unfollow a syr identity (P8). Self-contained: reads the viewer's
	 * follow state on mount and toggles it. Renders nothing when the viewer is
	 * logged out or looking at their own identity — the caller doesn't have to
	 * guard those cases.
	 */
	const {
		did,
		provider,
		size = 'sm',
		class: className = ''
	}: {
		did: string;
		/** The followed identity's home instance base URL. */
		provider?: string;
		size?: 'sm' | 'default' | 'lg';
		class?: string;
	} = $props();

	const auth = getAuth();
	const follows = getFollows();
	const isSelf = $derived(did === auth.identity?.did);
	const canFollow = $derived(!!auth.identity?.did && !isSelf && !!did);
	const following = $derived(follows.isFollowing(did));
	let busy = $state(false);

	$effect(() => {
		if (canFollow) void checkFollow(did, provider);
	});

	async function toggle() {
		if (busy || !canFollow) return;
		busy = true;
		try {
			if (following) {
				await unfollow(did, provider);
			} else {
				await follow(did, provider);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update follow');
		}
		busy = false;
	}
</script>

{#if canFollow}
	<Button
		variant={following ? 'outline' : 'default'}
		{size}
		disabled={busy}
		onclick={toggle}
		class={className}
	>
		{#if busy}
			<LoaderCircle class="mr-1.5 h-4 w-4 animate-spin" />
		{:else if following}
			<UserCheck class="mr-1.5 h-4 w-4" />
		{:else}
			<UserPlus class="mr-1.5 h-4 w-4" />
		{/if}
		{following ? 'Following' : 'Follow'}
	</Button>
{/if}
