<script lang="ts">
	// Renders a `<@did>` / `<@everyone>` mention token as a pill with the
	// resolved display name. A mention of the current viewer (or `@everyone`,
	// which pings everyone) is highlighted; other people's mentions render in a
	// subtle accent. Names resolve from the members store (for the instance URL)
	// + the federated profile cache — no profile data is stored by slyng.
	import { getAuth } from '@slyng/app-core/stores/auth.svelte';
	import { getMembers } from '@slyng/app-core/stores/members.svelte';
	import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';

	const { did }: { did: string } = $props();

	const auth = getAuth();
	const members = getMembers();

	const isEveryone = $derived(did === 'everyone');
	const mentionsMe = $derived(isEveryone || did === auth.identity?.did);
	const instanceUrl = $derived(members.list.find((m) => m.user_id === did)?.syr_instance_url);
	const label = $derived.by(() => {
		if (isEveryone) return 'everyone';
		return displayName(resolveProfile(did, instanceUrl), did);
	});
</script>

<span
	class="rounded px-1 py-0.5 text-sm font-medium {mentionsMe
		? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
		: 'bg-primary/10 text-primary'}"
>@{label}</span>
