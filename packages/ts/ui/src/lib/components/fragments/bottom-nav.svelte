<script lang="ts">
	// Mobile-only bottom tab bar rendered by SwipeLayout's mobile branch.
	// Gives first-time users a visible, always-reachable navigation surface
	// (recognition over recall) — the swipe gesture stays as the power-user
	// shortcut and this bar mirrors its state: opening the left drawer via
	// swipe lights up the Home tab, and vice versa.
	import { Menu, MessagesSquare, Users, CircleUser } from '@lucide/svelte';
	import { page } from '$app/state';
	import { getPaneState, setPane } from './swipe-layout/swipe-pane.svelte.js';

	const paneState = getPaneState();
	const drawerOpen = $derived(paneState.value === 'left');

	const path = $derived(page.url.pathname);
	// Same DM-route discrimination dm-layout uses: the @me root and DM
	// channels count as "DMs", the named @me sub-sections don't.
	const onDms = $derived(
		path === '/channels/@me' ||
			/^\/channels\/@me\/(?!friends|requests|ignored|posts|library)/.test(path)
	);
	const onFriends = $derived(path.startsWith('/channels/@me/friends'));
	const onYou = $derived(path.startsWith('/settings'));

	function toggleDrawer() {
		setPane(drawerOpen ? 'main' : 'left');
	}

	// Destination taps close any open drawer so the target screen is
	// actually visible when navigation lands.
	function closeDrawer() {
		if (paneState.value !== 'main') setPane('main');
	}

	// Base classes shared by every tab. ≥44×44 hit area (h-14 = 56px tall,
	// min-w-11 + flex-1 ≥ 44px wide on any viewport), visible label, pressed
	// feedback gated behind motion-safe so prefers-reduced-motion users get
	// none of the scale effect.
	const tabClass =
		'flex h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-95';
</script>

{#snippet indicator(active: boolean)}
	<!-- Active-tab indicator. Always in the DOM so state changes animate
	     transform/opacity only — never width/height/layout. -->
	<span
		aria-hidden="true"
		class="h-0.5 w-8 rounded-full bg-primary motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out {active
			? 'scale-x-100 opacity-100'
			: 'scale-x-0 opacity-0'}"
	></span>
{/snippet}

<!-- Safe-area extension strip. The root shells consume the bottom inset as
     shell padding (and zero --slyng-sai-* for descendants), so on notched
     iOS the ~34px strip below this bar would otherwise paint in the page
     background — a visible color seam. The shells capture the raw inset
     into --slyng-sai-bottom-captured before the zeroing scope; this strip
     repaints exactly that area in the bar's surface color. It adds no
     layout height, so the shell's padding remains the single inset
     consumer. `fixed` rather than `absolute top-full` because the
     SwipeLayout / app-layout ancestors are overflow-hidden and would clip
     anything hanging below the bar; no ancestor of this nav is
     transformed, so the viewport is the containing block and bottom-0
     lines up flush with the bar's bottom edge. Height resolves to 0
     wherever there is no inset. -->
<div
	aria-hidden="true"
	class="fixed inset-x-0 bottom-0 h-[var(--slyng-sai-bottom-captured,0px)] bg-sidebar"
></div>
<nav
	aria-label="Primary"
	class="flex shrink-0 items-stretch border-t border-border bg-sidebar"
>
	<button
		type="button"
		aria-expanded={drawerOpen}
		class="{tabClass} {drawerOpen ? 'text-primary' : 'text-muted-foreground'}"
		onclick={toggleDrawer}
	>
		{@render indicator(drawerOpen)}
		<Menu class="h-5 w-5" />
		<span>Home</span>
	</button>
	<a
		href="/channels/@me"
		aria-current={onDms && !drawerOpen ? 'page' : undefined}
		class="{tabClass} {onDms && !drawerOpen ? 'text-primary' : 'text-muted-foreground'}"
		onclick={closeDrawer}
	>
		{@render indicator(onDms && !drawerOpen)}
		<MessagesSquare class="h-5 w-5" />
		<span>DMs</span>
	</a>
	<a
		href="/channels/@me/friends"
		aria-current={onFriends && !drawerOpen ? 'page' : undefined}
		class="{tabClass} {onFriends && !drawerOpen ? 'text-primary' : 'text-muted-foreground'}"
		onclick={closeDrawer}
	>
		{@render indicator(onFriends && !drawerOpen)}
		<Users class="h-5 w-5" />
		<span>Friends</span>
	</a>
	<a
		href="/settings"
		aria-current={onYou && !drawerOpen ? 'page' : undefined}
		class="{tabClass} {onYou && !drawerOpen ? 'text-primary' : 'text-muted-foreground'}"
		onclick={closeDrawer}
	>
		{@render indicator(onYou && !drawerOpen)}
		<CircleUser class="h-5 w-5" />
		<span>You</span>
	</a>
</nav>
