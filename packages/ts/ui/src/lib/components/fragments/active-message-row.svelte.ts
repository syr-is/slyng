// Single-active message-action-bar guard. Mirrors the
// `active-profile-card.svelte.ts` pattern: each MessageItem derives its
// "is the action bar showing" state from `activeId === message.id` (on
// touch — desktop still uses hover), and tapping a row sets the rune.
// That auto-closes the bar on every other message in one render cycle,
// so users on mobile can't end up with two action bars open at the same
// time after tapping a second row.

let _activeId = $state<string | null>(null);

export function getActiveMessageRow(): { readonly value: string | null } {
	return {
		get value() {
			return _activeId;
		}
	};
}

export function setActiveMessageRow(id: string | null): void {
	_activeId = id;
}
