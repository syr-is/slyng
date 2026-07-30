/**
 * Server-wide message search (the channel search bar). Hits the authed
 * `/servers/:id/messages/search` endpoint via `idpJson` (plain fetch) rather
 * than the Rust WASM client — the search query is all query-params and the
 * response reuses the message wire shape, so no client regen is needed.
 *
 * The backend scopes results to the channels the caller can READ and excludes
 * soft-deleted messages, so the client can render every returned row as-is.
 */

import { idpJson } from '../idp-fetch.js';
import type { MessageData } from './messages.svelte';

/** A search hit: a message row plus the human name of the channel it lives in. */
export interface SearchMessage extends MessageData {
	channel_name?: string | null;
}

export interface MessageSearchParams {
	/** Free-text substring match against message content. */
	q?: string;
	/** `from:` — sender DID (exact). */
	sender_id?: string;
	/** `mentions:` — messages that mention this DID (or `everyone`). */
	mentions?: string;
	/** `in:` — restrict to a single channel id. */
	channel_id?: string;
	/** `has:` — any of link | file | image | video | embed (AND-combined). */
	has?: string[];
	/** `pinned:` — only pinned messages. */
	pinned?: boolean;
	/** `after:` — ISO date; messages sent at/after this instant. */
	since?: string;
	/** `before:` — ISO date; messages sent at/before this instant. */
	until?: string;
	limit?: number;
	offset?: number;
}

export interface MessageSearchResult {
	items: SearchMessage[];
	total: number;
}

export async function searchMessages(
	serverId: string,
	params: MessageSearchParams
): Promise<MessageSearchResult> {
	const qs = new URLSearchParams();
	if (params.q?.trim()) qs.set('q', params.q.trim());
	if (params.sender_id) qs.set('sender_id', params.sender_id);
	if (params.mentions) qs.set('mentions', params.mentions);
	if (params.channel_id) qs.set('channel_id', params.channel_id);
	if (params.has?.length) qs.set('has', params.has.join(','));
	if (params.pinned) qs.set('pinned', 'true');
	if (params.since) qs.set('since', params.since);
	if (params.until) qs.set('until', params.until);
	qs.set('limit', String(params.limit ?? 25));
	qs.set('offset', String(params.offset ?? 0));

	return idpJson<MessageSearchResult>(
		`/servers/${encodeURIComponent(serverId)}/messages/search?${qs.toString()}`
	);
}
