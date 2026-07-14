/**
 * Members for the active server. Auto-syncs via WS MEMBER_UPDATE / MEMBER_REMOVE.
 */

import { WsOp } from '@slyng/types';
import type { ServerMember } from '@slyng/client';
import { onWsEvent } from './ws.svelte';
import { recordIdString } from '../utils/record-id';
import { normalizeMember } from './normalize';

export interface MemberData {
	id?: string;
	user_id: string;
	server_id?: string;
	syr_instance_url?: string;
	role_ids?: string[];
	roles?: { id: string; name: string; color: string | null; position: number }[];
	[key: string]: unknown;
}

let activeServerId = $state<string | null>(null);
let members = $state<MemberData[]>([]);

export function getMembers() {
	return {
		get serverId() {
			return activeServerId;
		},
		get list() {
			return members;
		}
	};
}

export function setMembers(serverId: string | null, list: ServerMember[]) {
	activeServerId = serverId;
	members = list.map(normalizeMember);
}

export function clearMembers() {
	activeServerId = null;
	members = [];
}

function matchesActive(serverIdField: unknown): boolean {
	if (!activeServerId) return false;
	return recordIdString(serverIdField) === activeServerId;
}

onWsEvent(WsOp.MEMBER_UPDATE, (data) => {
	const m = data as MemberData;
	if (!matchesActive(m.server_id)) return;
	// Normalize RecordId fields: WS payloads may carry raw RecordId objects
	// ({ tb, id }) while the initial HTTP load already stringified them.
	// Without this, the mod sheet's derived comparisons break.
	if (m.role_ids) {
		m.role_ids = m.role_ids.map((r) => recordIdString(r) ?? String(r));
	}
	if (m.id) m.id = recordIdString(m.id) ?? String(m.id);
	if (m.server_id) m.server_id = recordIdString(m.server_id) ?? String(m.server_id);
	const idx = members.findIndex((x) => x.user_id === m.user_id);
	if (idx < 0) {
		members = [...members, m];
	} else {
		const next = [...members];
		next[idx] = { ...next[idx], ...m };
		members = next;
	}
});

onWsEvent(WsOp.MEMBER_REMOVE, (data) => {
	const { user_id, server_id } = data as { user_id: string; server_id: string };
	if (!matchesActive(server_id)) return;
	members = members.filter((m) => m.user_id !== user_id);
});
