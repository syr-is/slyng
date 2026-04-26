// Shared pane state for SwipeLayout. SwipeLayout reads + writes this; pages
// nested inside the main snippet can also call `setPane('right')` from a
// header button (e.g. the channel-header members icon) to open the drawer
// without each page needing its own context plumbing.

export type Pane = 'left' | 'main' | 'right';

let _pane = $state<Pane>('main');

export function getPaneState(): { readonly value: Pane } {
	return {
		get value() {
			return _pane;
		}
	};
}

export function setPane(next: Pane): void {
	_pane = next;
}
