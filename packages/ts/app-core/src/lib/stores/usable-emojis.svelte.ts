/**
 * The custom emoji a user can actually TYPE (composer) and SEE (renderer),
 * unified across every source they have access to: their own hosted emoji
 * (`resolveEmojis`) ∪ every server they're a member of (`server-media`). This
 * is what lets server emoji be used platform-wide — in any channel and in DMs.
 *
 * Every read is `$derived`-safe: it only touches the reactive emoji caches
 * (`SvelteMap`s) + the reactive server list, so calling these inside a
 * `$derived` re-runs when any of them change.
 */
import { getAuth } from './auth.svelte';
import { resolveEmojis, type EmojiEntry } from './emojis.svelte';
import { myServerEmojiEntries } from './server-media.svelte';

const auth = getAuth();

/** De-dupe by shortcode (first wins), then rank starts-with before contains. */
function rank(entries: EmojiEntry[], query: string, limit: number): EmojiEntry[] {
	const seen = new Set<string>();
	const uniq: EmojiEntry[] = [];
	for (const e of entries) {
		if (seen.has(e.shortcode)) continue;
		seen.add(e.shortcode);
		uniq.push(e);
	}
	const q = query.trim().toLowerCase();
	if (!q) return uniq.slice(0, limit);
	const starts: EmojiEntry[] = [];
	const contains: EmojiEntry[] = [];
	for (const e of uniq) {
		const sc = e.shortcode.toLowerCase();
		if (sc.startsWith(q)) starts.push(e);
		else if (sc.includes(q)) contains.push(e);
	}
	return [...starts, ...contains].slice(0, limit);
}

/** Every emoji the current user can insert (own ∪ their servers'), ranked. */
export function searchComposerEmojis(query: string, limit: number): EmojiEntry[] {
	const did = auth.identity?.did;
	const entries: EmojiEntry[] = [];
	if (did) entries.push(...resolveEmojis(did, auth.identity?.syr_instance_url).entries);
	entries.push(...myServerEmojiEntries());
	return rank(entries, query, limit);
}

/** The full composer emoji list (the picker's "custom" tab). */
export function composerEmojiList(): EmojiEntry[] {
	return searchComposerEmojis('', 100000);
}

/**
 * Shortcode → emoji map for rendering a message. The sender's own hosted emoji,
 * unioned with the viewer's accessible server emoji (so a server emoji used in
 * a DM still resolves for a fellow member). The sender's personal set wins on a
 * shortcode collision (their message, their emoji).
 */
export function renderEmojiMap(
	senderId: string,
	senderInstanceUrl?: string
): Map<string, EmojiEntry> {
	const map = new Map<string, EmojiEntry>();
	for (const e of myServerEmojiEntries()) map.set(e.shortcode, e);
	for (const [code, entry] of resolveEmojis(senderId, senderInstanceUrl).map) map.set(code, entry);
	return map;
}
