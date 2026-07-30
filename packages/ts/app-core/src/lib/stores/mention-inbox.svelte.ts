/**
 * Global mention inbox — the Discord-style "Mentions" feed. Holds the most
 * recent messages that mention the current user across every server they're in.
 * Seeded from `GET /mentions` on open and kept live by the server's per-user
 * MENTION_ADD event (AI.md rule 1: no reload). Dismissal is client-side +
 * ephemeral (AI.md rule 4) — the entry reappears on a fresh fetch if still
 * within the window, matching Discord's "clear from inbox" affordance.
 */

import { WsOp } from '@slyng/types';
import { onWsEvent } from './ws.svelte';
import { idpJson } from '../idp-fetch.js';
import type { SearchMessage } from './message-search.svelte';

export interface MentionEntry extends SearchMessage {
	server_id?: string | null;
}

let entries = $state<MentionEntry[]>([]);
let loading = $state(false);
let loaded = $state(false);
const dismissed = new Set<string>();

export function getMentionInbox() {
	return {
		get entries() {
			return entries;
		},
		get loading() {
			return loading;
		},
		get loaded() {
			return loaded;
		},
		/** Unseen count for the inbox badge. */
		get count() {
			return entries.length;
		}
	};
}

export async function loadMentionInbox(): Promise<void> {
	loading = true;
	try {
		const res = await idpJson<{ items: MentionEntry[]; total: number }>('/mentions?limit=50');
		entries = res.items.filter((e) => !dismissed.has(e.id));
		loaded = true;
	} finally {
		loading = false;
	}
}

export function dismissMention(id: string): void {
	dismissed.add(id);
	entries = entries.filter((e) => e.id !== id);
}

export function clearMentionInbox(): void {
	entries = [];
	loaded = false;
	dismissed.clear();
}

onWsEvent(WsOp.MENTION_ADD, (data) => {
	const d = data as {
		message?: MentionEntry;
		channel_name?: string;
		server_id?: string;
	};
	if (!d.message || dismissed.has(d.message.id)) return;
	const entry: MentionEntry = {
		...d.message,
		channel_name: d.channel_name ?? d.message.channel_name ?? null,
		server_id: d.server_id ?? null
	};
	entries = [entry, ...entries.filter((e) => e.id !== entry.id)];
});
