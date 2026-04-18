/**
 * Roles for the active server. Auto-syncs via WS ROLE_CREATE/UPDATE/DELETE.
 */

import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { recordIdString } from '$lib/utils/record-id';

export interface RoleData {
	id: string;
	name: string;
	color: string | null;
	permissions: string;
	position: number;
	is_default?: boolean;
	server_id?: string;
}

let activeServerId = $state<string | null>(null);
let roles = $state<RoleData[]>([]);

export function getRoles() {
	return {
		get serverId() {
			return activeServerId;
		},
		get list() {
			return roles;
		}
	};
}

export function setRoles(serverId: string | null, list: RoleData[]) {
	activeServerId = serverId;
	roles = [...list].sort((a, b) => b.position - a.position); // highest first
}

export function clearRoles() {
	activeServerId = null;
	roles = [];
}

export function reorderRoles(roleIds: string[]) {
	const targetRoles = roles.filter((r) => roleIds.includes(r.id));
	const positions = targetRoles.map((r) => r.position).sort((a, b) => b - a);
	const posMap = new Map(roleIds.map((id, i) => [id, positions[i]]));
	roles = sort(roles.map((r) => (posMap.has(r.id) ? { ...r, position: posMap.get(r.id)! } : r)));
}

function matchesActive(serverIdField: unknown): boolean {
	if (!activeServerId) return false;
	return recordIdString(serverIdField) === activeServerId;
}

function sort(list: RoleData[]) {
	return [...list].sort((a, b) => b.position - a.position);
}

onWsEvent(WsOp.ROLE_CREATE, (data) => {
	const r = data as RoleData;
	if (!matchesActive(r.server_id)) return;
	if (roles.some((x) => x.id === r.id)) return;
	roles = sort([...roles, r]);
});

onWsEvent(WsOp.ROLE_UPDATE, (data) => {
	const r = data as RoleData;
	if (!matchesActive(r.server_id)) return;
	const idx = roles.findIndex((x) => x.id === r.id);
	if (idx < 0) return;
	const next = [...roles];
	next[idx] = { ...next[idx], ...r };
	roles = sort(next);
});

onWsEvent(WsOp.ROLE_DELETE, (data) => {
	const { id, server_id } = data as { id: string; server_id: string };
	if (!matchesActive(server_id)) return;
	roles = roles.filter((r) => r.id !== id);
});
