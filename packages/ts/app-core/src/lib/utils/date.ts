/**
 * Calendar-relative day label for the day-separator banner inside a chat
 * timeline. Today / Yesterday / "April 26, 2026" etc., respecting the
 * caller's locale.
 */
export function formatDateLabel(date: Date): string {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const days = (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Coarse "just now / Nm ago / Nh ago / Nd ago" relative-time string for an
 * ISO timestamp. Intended for low-precision badges next to friend requests,
 * audit-log rows, etc. — not for live-updating timestamps.
 */
export function formatAgo(iso: string): string {
	const delta = Date.now() - new Date(iso).getTime();
	const m = Math.floor(delta / 60_000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}
