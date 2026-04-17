/**
 * Tokenize message content into a mix of plain text and emoji/sticker
 * references. Rendering is left to the component (for safe DOM instead of
 * raw HTML strings).
 *
 * Patterns (mirroring syr):
 *   - Sticker:  `::shortcode::`  (double colons, rendered larger, block-level)
 *   - Emoji:    `:shortcode:`    (single colons, inline with text)
 */

import type { EmojiEntry } from '$lib/stores/emojis.svelte';

export type RenderToken =
	| { kind: 'text'; value: string }
	| { kind: 'link'; url: string }
	| { kind: 'emoji'; entry: EmojiEntry; shortcode: string }
	| { kind: 'sticker'; entry: EmojiEntry; shortcode: string }
	| { kind: 'unknown_shortcode'; shortcode: string; sticker: boolean };

const STICKER_RE = /::([a-zA-Z0-9_~+-]+)::/g;
const EMOJI_RE = /(?<!:):([a-zA-Z0-9_~+-]+):(?!:)/g;

type Match = { start: number; end: number; shortcode: string; sticker: boolean };

export function renderEmojis(
	content: string,
	map: Map<string, EmojiEntry> | undefined
): RenderToken[] {
	if (!content) return [];

	const matches: Match[] = [];
	// Stickers first so `::x::` isn't greedy-swallowed by the single-colon
	// pattern's `:x:` half.
	let m: RegExpExecArray | null;
	STICKER_RE.lastIndex = 0;
	while ((m = STICKER_RE.exec(content)) !== null) {
		matches.push({ start: m.index, end: m.index + m[0].length, shortcode: m[1], sticker: true });
	}
	EMOJI_RE.lastIndex = 0;
	while ((m = EMOJI_RE.exec(content)) !== null) {
		const s = m.index;
		const e = m.index + m[0].length;
		// Drop emoji matches that overlap with an already-captured sticker span
		if (matches.some((x) => x.sticker && s >= x.start && e <= x.end)) continue;
		matches.push({ start: s, end: e, shortcode: m[1], sticker: false });
	}
	matches.sort((a, b) => a.start - b.start);

	const tokens: RenderToken[] = [];
	let cursor = 0;
	for (const match of matches) {
		if (match.start > cursor) {
			tokens.push({ kind: 'text', value: content.slice(cursor, match.start) });
		}
		const entry = map?.get(match.shortcode);
		if (entry) {
			// Size is determined by the syntax (`:x:` vs `::x::`), not the
			// stored `is_sticker` flag. Any matching shortcode can be rendered
			// big when double-colon syntax is used.
			tokens.push({
				kind: match.sticker ? 'sticker' : 'emoji',
				entry,
				shortcode: match.shortcode
			});
		} else {
			tokens.push({ kind: 'unknown_shortcode', shortcode: match.shortcode, sticker: match.sticker });
		}
		cursor = match.end;
	}
	if (cursor < content.length) {
		tokens.push({ kind: 'text', value: content.slice(cursor) });
	}
	return linkifyTextTokens(tokens);
}

const URL_RE = /https?:\/\/[^\s<>]+/g;

/** Split text tokens that contain URLs into text + link + text sequences. */
function linkifyTextTokens(tokens: RenderToken[]): RenderToken[] {
	const out: RenderToken[] = [];
	for (const token of tokens) {
		if (token.kind !== 'text') {
			out.push(token);
			continue;
		}
		let cursor = 0;
		URL_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = URL_RE.exec(token.value)) !== null) {
			if (match.index > cursor) {
				out.push({ kind: 'text', value: token.value.slice(cursor, match.index) });
			}
			out.push({ kind: 'link', url: match[0] });
			cursor = match.index + match[0].length;
		}
		if (cursor === 0) {
			// No URLs found — keep original token
			out.push(token);
		} else if (cursor < token.value.length) {
			out.push({ kind: 'text', value: token.value.slice(cursor) });
		}
	}
	return out;
}

/** True if the message is only sticker references (+ whitespace). */
export function isStickerOnly(tokens: RenderToken[]): boolean {
	let sawSticker = false;
	for (const t of tokens) {
		if (t.kind === 'sticker') sawSticker = true;
		else if (t.kind === 'text') {
			if (t.value.trim().length > 0) return false;
		} else {
			return false;
		}
	}
	return sawSticker;
}
