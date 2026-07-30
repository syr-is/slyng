/**
 * Server-owned emoji/sticker + GIF sets. Server-native (not federated): fetched
 * from the slyng API (`GET /servers/:id/emojis|gifs`, member-authed) and cached
 * per server. The store registers itself as a provider with `usable-emojis` so a
 * member's server emoji merge into the composer autocomplete + the message
 * renderer — usable ANYWHERE on the platform (every channel and DM), not just
 * inside that server. Invalidated per-server on `SERVER_EMOJI_UPDATE`.
 */
import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@slyng/types';
import { idpJson } from '../idp-fetch.js';
import { onWsEvent } from './ws.svelte';
import { getServerState } from './servers.svelte';
import type { EmojiEntry } from './emojis.svelte';

export interface ServerGifEntry {
	id: string;
	url: string;
	thumbnail_url: string | null;
	tags: string[];
}

interface EmojiBundle {
	serverId: string;
	entries: EmojiEntry[];
	loading: boolean;
	error?: boolean;
}
interface GifBundle {
	serverId: string;
	entries: ServerGifEntry[];
	loading: boolean;
	error?: boolean;
}

const emojiCache = new SvelteMap<string, EmojiBundle>();
const gifCache = new SvelteMap<string, GifBundle>();
const emojiInflight = new Map<string, Promise<void>>();
const gifInflight = new Map<string, Promise<void>>();

async function fetchEmojis(serverId: string): Promise<void> {
	try {
		const res = await idpJson<{ data: { shortcode: string; url: string | null; is_sticker: boolean }[] }>(
			`/servers/${encodeURIComponent(serverId)}/emojis`,
			{ cache: 'no-store' }
		);
		emojiCache.set(serverId, {
			serverId,
			entries: res.data
				.filter((e) => !!e.url)
				.map((e) => ({ shortcode: e.shortcode, url: e.url as string, is_sticker: e.is_sticker })),
			loading: false
		});
	} catch {
		emojiCache.set(serverId, { serverId, entries: [], loading: false, error: true });
	} finally {
		emojiInflight.delete(serverId);
	}
}

async function fetchGifs(serverId: string): Promise<void> {
	try {
		const res = await idpJson<{ data: ServerGifEntry[] }>(
			`/servers/${encodeURIComponent(serverId)}/gifs`,
			{ cache: 'no-store' }
		);
		gifCache.set(serverId, {
			serverId,
			entries: (res.data ?? []).filter((g) => !!g.url),
			loading: false
		});
	} catch {
		gifCache.set(serverId, { serverId, entries: [], loading: false, error: true });
	} finally {
		gifInflight.delete(serverId);
	}
}

/** A server's emoji set; kicks a background fetch on first miss. `$derived`-safe. */
export function resolveServerEmojis(serverId: string): EmojiBundle {
	const cached = emojiCache.get(serverId);
	if (cached) return cached;
	if (!emojiInflight.has(serverId)) emojiInflight.set(serverId, fetchEmojis(serverId));
	return { serverId, entries: [], loading: true };
}

/** A server's GIF set; kicks a background fetch on first miss. `$derived`-safe. */
export function resolveServerGifs(serverId: string): GifBundle {
	const cached = gifCache.get(serverId);
	if (cached) return cached;
	if (!gifInflight.has(serverId)) gifInflight.set(serverId, fetchGifs(serverId));
	return { serverId, entries: [], loading: true };
}

/** Force a re-fetch (after the manager adds/removes one, before the WS lands). */
export function invalidateServerMedia(serverId: string): void {
	emojiCache.delete(serverId);
	emojiInflight.delete(serverId);
	gifCache.delete(serverId);
	gifInflight.delete(serverId);
}

/**
 * Every server-emoji entry the current user can access — the union across every
 * server they're a member of. Consumed by `usable-emojis` for the composer +
 * renderer. Iterating the reactive server list means a newly-joined server's
 * emoji appear automatically, and (via resolveServerEmojis) a set invalidated by
 * SERVER_EMOJI_UPDATE re-fetches on the next read. `$derived`-safe.
 */
export function myServerEmojiEntries(): EmojiEntry[] {
	const out: EmojiEntry[] = [];
	for (const s of getServerState().servers) out.push(...resolveServerEmojis(s.id).entries);
	return out;
}

onWsEvent(WsOp.SERVER_EMOJI_UPDATE, (raw) => {
	const d = raw as { server_id?: string };
	if (d?.server_id) invalidateServerMedia(d.server_id);
});

// ── Management helpers (MANAGE_EMOJIS; used by the server-settings panel) ──

/** Full owner-facing rows (include the id needed to delete). */
export interface ServerEmojiItem {
	id: string;
	shortcode: string;
	url: string | null;
	is_sticker: boolean;
}
export interface ServerGifItem {
	id: string;
	url: string | null;
	thumbnail_url: string | null;
	tags: string[];
}

interface Envelope<T> {
	status: string;
	data: T;
	limit?: number;
}
interface Presign {
	signed_url: string;
	final_url: string;
	id: string;
}

async function putFile(signedUrl: string, file: File): Promise<void> {
	const res = await fetch(signedUrl, {
		method: 'PUT',
		body: file,
		headers: { 'Content-Type': file.type }
	});
	if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

function base(serverId: string): string {
	return `/servers/${encodeURIComponent(serverId)}`;
}

export async function listServerEmojiItems(
	serverId: string
): Promise<{ items: ServerEmojiItem[]; limit: number }> {
	const res = await idpJson<Envelope<ServerEmojiItem[]>>(`${base(serverId)}/emojis`, {
		cache: 'no-store'
	});
	return { items: res.data, limit: res.limit ?? 250 };
}

export async function uploadServerEmoji(
	serverId: string,
	file: File,
	shortcode: string,
	isSticker = false
): Promise<void> {
	const { data: presign } = await idpJson<Envelope<Presign>>(`${base(serverId)}/emojis/presign`, {
		method: 'POST',
		body: JSON.stringify({
			shortcode,
			filename: file.name,
			mime_type: file.type,
			size: file.size,
			is_sticker: isSticker
		})
	});
	await putFile(presign.signed_url, file);
	await idpJson(`${base(serverId)}/emojis/${encodeURIComponent(presign.id)}/complete`, {
		method: 'POST',
		body: JSON.stringify({})
	});
	invalidateServerMedia(serverId);
}

export async function deleteServerEmoji(serverId: string, id: string): Promise<void> {
	await idpJson(`${base(serverId)}/emojis/${encodeURIComponent(id)}`, { method: 'DELETE' });
	invalidateServerMedia(serverId);
}

export async function listServerGifItems(
	serverId: string
): Promise<{ items: ServerGifItem[]; limit: number }> {
	const res = await idpJson<Envelope<ServerGifItem[]>>(`${base(serverId)}/gifs`, {
		cache: 'no-store'
	});
	return { items: res.data, limit: res.limit ?? 250 };
}

export async function uploadServerGif(
	serverId: string,
	file: File,
	tags: string[] = []
): Promise<void> {
	const { data: presign } = await idpJson<Envelope<Presign>>(`${base(serverId)}/gifs/presign`, {
		method: 'POST',
		body: JSON.stringify({
			filename: file.name,
			mime_type: file.type,
			size: file.size,
			...(tags.length ? { tags } : {})
		})
	});
	await putFile(presign.signed_url, file);
	await idpJson(`${base(serverId)}/gifs/${encodeURIComponent(presign.id)}/complete`, {
		method: 'POST',
		body: JSON.stringify({})
	});
	invalidateServerMedia(serverId);
}

export async function deleteServerGif(serverId: string, id: string): Promise<void> {
	await idpJson(`${base(serverId)}/gifs/${encodeURIComponent(id)}`, { method: 'DELETE' });
	invalidateServerMedia(serverId);
}
