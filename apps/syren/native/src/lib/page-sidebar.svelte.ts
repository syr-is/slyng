import type { Snippet } from 'svelte';

// Mobile-friendly sidebar plumbing. Per-page layouts (DM @me, server
// channels) register a snippet here on mount; the (app) layout reads it
// and feeds it to SwipeLayout's drawer slot. Result: on mobile, only
// the page's main content is visible by default; swipe right opens the
// rail + the registered sidebar in the drawer. On desktop the drawer
// is always visible, so the sidebar lives there too — no inline copy.
let _sidebar = $state<Snippet | undefined>(undefined);

export function getPageSidebar(): { readonly value: Snippet | undefined } {
	return {
		get value() {
			return _sidebar;
		}
	};
}

export function setPageSidebar(snippet: Snippet | undefined): void {
	_sidebar = snippet;
}
