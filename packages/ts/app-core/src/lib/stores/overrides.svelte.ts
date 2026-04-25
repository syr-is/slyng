/**
 * Permission overrides cache for the active server. Fetched per-scope on
 * demand (when a permission editor opens). Invalidated reactively via
 * PERMISSION_OVERRIDE_UPDATE WS events.
 */

import { SvelteMap } from 'svelte/reactivity';
import { WsOp } from '@syren/types';
import { onWsEvent } from './ws.svelte';
import { api } from '../api';

export interface OverrideData {
	id: string;
	server_id: string;
	scope_type: 'server' | 'category' | 'channel';
	scope_id: string | null;
	target_type: 'role' | 'user';
	target_id: string;
	allow: string;
	deny: string;
}

interface ScopeCache {
	overrides: OverrideData[];
	loading: boolean;
}

const cache = new SvelteMap<string, ScopeCache>();
const inflight = new Map<string, Promise<void>>();

function scopeKey(scopeType: string, scopeId: string | null): string {
	return `${scopeType}:${scopeId ?? 'server'}`;
}

async function fetchScope(serverId: string, scopeType: string, scopeId: string | null) {
	const key = scopeKey(scopeType, scopeId);
	try {
		let data: unknown[];
		if (scopeType === 'channel' && scopeId) {
			data = await api.overrides.forChannel(serverId, scopeId);
		} else if (scopeType === 'category' && scopeId) {
			data = await api.overrides.forCategory(serverId, scopeId);
		} else {
			data = await api.overrides.list(serverId);
		}
		cache.set(key, { overrides: data as OverrideData[], loading: false });
	} catch {
		cache.set(key, { overrides: [], loading: false });
	} finally {
		inflight.delete(key);
	}
}

export function loadOverrides(serverId: string, scopeType: string, scopeId: string | null) {
	const key = scopeKey(scopeType, scopeId);
	if (cache.has(key) || inflight.has(key)) return;
	cache.set(key, { overrides: [], loading: true });
	inflight.set(key, fetchScope(serverId, scopeType, scopeId));
}

export function getOverrides(scopeType: string, scopeId: string | null): ScopeCache {
	const key = scopeKey(scopeType, scopeId);
	return cache.get(key) ?? { overrides: [], loading: false };
}

export function invalidateOverrides(scopeType: string, scopeId: string | null) {
	const key = scopeKey(scopeType, scopeId);
	cache.delete(key);
	inflight.delete(key);
}

export function clearAllOverrides() {
	cache.clear();
	inflight.clear();
}

onWsEvent(WsOp.PERMISSION_OVERRIDE_UPDATE, (raw) => {
	const d = raw as { scope_type?: string; scope_id?: string | null };
	if (d?.scope_type) {
		invalidateOverrides(d.scope_type, d.scope_id ?? null);
		// Also invalidate server-level cache since the full list changed
		invalidateOverrides('server', null);
	}
});
