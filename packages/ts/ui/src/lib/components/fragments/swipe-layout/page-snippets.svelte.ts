import type { Snippet } from 'svelte';

// Mobile-friendly per-page panels. Each child layout / page registers
// the snippets it wants in the SwipeLayout drawers on mount; the (app)
// layout reads them and feeds SwipeLayout's `sidebar` (left drawer
// behind the rail) and `members` (right drawer) slots. On mobile, the
// page's main content is the only thing visible by default — swiping
// or tapping the corresponding hamburger opens the matching drawer. On
// desktop, SwipeLayout shows them all in-line, no inline duplication.
let _sidebar = $state<Snippet | undefined>(undefined);
let _members = $state<Snippet | undefined>(undefined);

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

export function getPageMembers(): { readonly value: Snippet | undefined } {
	return {
		get value() {
			return _members;
		}
	};
}

export function setPageMembers(snippet: Snippet | undefined): void {
	_members = snippet;
}
