/**
 * Server + channel state for the current user. Realtime sidebar updates
 * via CHANNEL_CREATE / CHANNEL_UPDATE / CHANNEL_DELETE WS events.
 */

import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { getAuth } from './auth.svelte';

interface ServerData {
	id: string;
	name: string;
	icon_url?: string | null;
	banner_url?: string | null;
	invite_background_url?: string | null;
	description?: string | null;
	owner_id: string;
	member_count: number;
}

interface ChannelData {
	id: string;
	name?: string;
	type: string;
	server_id?: string;
	category_id?: string;
	position: number;
	topic?: string;
}

let servers = $state<ServerData[]>([]);
let activeServerId = $state<string | null>(null);
let activeServerOwnerId = $state<string | null>(null);
let serverChannels = $state<ChannelData[]>([]);
let channelsLoaded = $state(false);

export function getServerState() {
	return {
		get servers() {
			return servers;
		},
		get activeServerId() {
			return activeServerId;
		},
		get activeServerOwnerId() {
			return activeServerOwnerId;
		},
		get activeServer() {
			return activeServerId ? servers.find((s) => s.id === activeServerId) ?? null : null;
		},
		get channels() {
			return serverChannels;
		},
		get channelsLoaded() {
			return channelsLoaded;
		}
	};
}

/** Upsert/patch a server record in the list (used by WS + local updates). */
export function upsertServer(server: Partial<ServerData> & { id: string }) {
	const idx = servers.findIndex((s) => s.id === server.id);
	if (idx < 0) {
		servers = [...servers, server as ServerData];
	} else {
		const next = [...servers];
		next[idx] = { ...next[idx], ...server };
		servers = next;
	}
}

export function removeServer(serverId: string) {
	servers = servers.filter((s) => s.id !== serverId);
}

export function setServers(data: ServerData[]) {
	servers = data;
}

export function setActiveServer(serverId: string | null) {
	activeServerId = serverId;
	// Reset everything when switching servers
	activeServerOwnerId = null;
	serverChannels = [];
	channelsLoaded = false;
}

export function setActiveServerOwner(ownerId: string | null) {
	activeServerOwnerId = ownerId;
}

export function setServerChannels(channels: ChannelData[]) {
	serverChannels = channels;
	channelsLoaded = true;
}

// ── Realtime sidebar updates ──

function matchesActiveServer(serverIdField: unknown): boolean {
	if (!activeServerId || !serverIdField) return false;
	return String(serverIdField) === activeServerId;
}

onWsEvent(WsOp.CHANNEL_CREATE, (data) => {
	const ch = data as ChannelData;
	if (!matchesActiveServer((ch as any).server_id)) return;
	if (serverChannels.some((c) => c.id === ch.id)) return;
	serverChannels = [...serverChannels, ch].sort((a, b) => a.position - b.position);
});

onWsEvent(WsOp.CHANNEL_UPDATE, (data) => {
	const ch = data as ChannelData;
	if (!matchesActiveServer((ch as any).server_id)) return;
	const idx = serverChannels.findIndex((c) => c.id === ch.id);
	if (idx < 0) return;
	const next = [...serverChannels];
	next[idx] = { ...next[idx], ...ch };
	serverChannels = next;
});

onWsEvent(WsOp.CHANNEL_DELETE, (data) => {
	const { id, server_id } = data as { id: string; server_id: string };
	if (!matchesActiveServer(server_id)) return;
	serverChannels = serverChannels.filter((c) => c.id !== id);
});

onWsEvent(WsOp.SERVER_UPDATE, (data) => {
	const srv = data as { id: unknown } & Partial<ServerData>;
	if (!srv?.id) return;
	upsertServer({ ...(srv as any), id: String(srv.id) });
});

onWsEvent(WsOp.SERVER_DELETE, (data) => {
	const { id } = data as { id: string };
	if (!id) return;
	removeServer(String(id));
	if (activeServerId === String(id)) {
		activeServerId = null;
		activeServerOwnerId = null;
		serverChannels = [];
		channelsLoaded = false;
	}
});

// If the local user is kicked/banned from a server, MEMBER_REMOVE arrives on
// the server topic. Strip the server from the rail so the user can't keep
// pretending to be in it (layout-level guards handle the redirect).
onWsEvent(WsOp.MEMBER_REMOVE, (data) => {
	const { user_id, server_id } = data as { user_id?: string; server_id?: string };
	if (!user_id || !server_id) return;
	const selfDid = getAuth().identity?.did;
	if (!selfDid || user_id !== selfDid) return;
	removeServer(String(server_id));
});
