import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent, send } from './ws.svelte';

/**
 * User presence tracking. Updated by WS events.
 *
 * Status values: online | idle | dnd | invisible | offline
 * (invisible only ever applies to the local user — others always see them as
 *  offline, server-side translation.)
 *
 * Uses SvelteMap (not a $state record) because $state proxies only track
 * properties that already exist on read. With a record, reading
 * `presences[did]` for a not-yet-known user returns undefined and registers
 * no dependency, so a later write never triggers a re-derive. SvelteMap.get()
 * registers per-key dependency unconditionally.
 */

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface PresenceData {
	status: PresenceStatus;
	custom_status?: string;
	custom_emoji?: string;
}

const presences = new SvelteMap<string, PresenceData>();

const OFFLINE: PresenceData = { status: 'offline' };

export function getPresence(userId: string): PresenceStatus {
	return presences.get(userId)?.status ?? 'offline';
}

export function getPresenceData(userId: string): PresenceData {
	return presences.get(userId) ?? OFFLINE;
}

export function setPresence(userId: string, data: PresenceData) {
	if (data.status === 'offline') {
		presences.delete(userId);
	} else {
		presences.set(userId, data);
	}
}

/** Push a status change for the current user up to the server. */
export function updateMyPresence(data: Partial<PresenceData>) {
	send({ op: WsOp.PRESENCE_UPDATE, d: data });
}

onWsEvent(WsOp.PRESENCE_UPDATE_BROADCAST, (raw) => {
	const d = raw as { user_id: string; status: PresenceStatus; custom_status?: string; custom_emoji?: string };
	setPresence(d.user_id, {
		status: d.status,
		custom_status: d.custom_status,
		custom_emoji: d.custom_emoji
	});
});

// READY snapshot — populates presences for users already online when we connect
onWsEvent(WsOp.READY, (raw) => {
	const d = raw as { presences?: { user_id: string; status: PresenceStatus; custom_status?: string; custom_emoji?: string }[] };
	if (!d?.presences) return;
	for (const p of d.presences) {
		setPresence(p.user_id, {
			status: p.status,
			custom_status: p.custom_status,
			custom_emoji: p.custom_emoji
		});
	}
});
