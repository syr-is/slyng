/**
 * Members for the active server. Auto-syncs via WS MEMBER_UPDATE / MEMBER_REMOVE.
 */

import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';

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

export function setMembers(serverId: string | null, list: MemberData[]) {
	activeServerId = serverId;
	members = list;
}

export function clearMembers() {
	activeServerId = null;
	members = [];
}

function matchesActive(serverIdField: unknown): boolean {
	if (!activeServerId || !serverIdField) return false;
	return String(serverIdField) === activeServerId;
}

onWsEvent(WsOp.MEMBER_UPDATE, (data) => {
	const m = data as MemberData;
	if (!matchesActive(m.server_id)) return;
	const idx = members.findIndex((x) => x.user_id === m.user_id);
	if (idx < 0) {
		members = [...members, m];
	} else {
		const next = [...members];
		// Preserve client-resolved fields (syr_instance_url, roles) while patching role_ids
		next[idx] = { ...next[idx], ...m };
		members = next;
	}
});

onWsEvent(WsOp.MEMBER_REMOVE, (data) => {
	const { user_id, server_id } = data as { user_id: string; server_id: string };
	if (!matchesActive(server_id)) return;
	members = members.filter((m) => m.user_id !== user_id);
});
