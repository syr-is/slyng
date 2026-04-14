/**
 * Svelte action: sets `el.srcObject` to the supplied MediaStream and
 * tears it down on unmount. Use on `<video>` and `<audio>` elements.
 */
export function attachStream(el: HTMLMediaElement, stream: MediaStream | null) {
	el.srcObject = stream;
	return {
		update(next: MediaStream | null) {
			el.srcObject = next;
		},
		destroy() {
			el.srcObject = null;
		}
	};
}
