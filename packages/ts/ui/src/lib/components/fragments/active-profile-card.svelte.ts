// Single-active-card guard for ProfileHoverCard. Each card derives its
// open state from `_activeId === ownId`; opening a card sets the rune,
// which automatically closes every other card whose derivation now reads
// false. Avoids the per-component `let hoverOpen = $state(false)` we had,
// where two cards could be open at once because each held its own state.

let _activeId = $state<string | null>(null);

export function getActiveProfileCard(): { readonly value: string | null } {
	return {
		get value() {
			return _activeId;
		}
	};
}

export function setActiveProfileCard(id: string | null): void {
	_activeId = id;
}
