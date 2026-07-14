/**
 * Instance-level, admin-configurable upload limits (per-file cap + per-account
 * storage quota). Read publicly for client-side validation + display; the admin
 * status + writes are session-authed. Backed by `/api/instance/*`.
 */

import { idpJson } from '../idp-fetch.js';
import type {
	InstanceLimits,
	InstanceLimitsPatch,
	InstanceUsersPage,
	OwnedUploadsPage
} from '@syren/types';

let limits = $state<InstanceLimits | null>(null);
let isAdmin = $state(false);
let adminChecked = $state(false);

export function getInstance() {
	return {
		get limits() {
			return limits;
		},
		get isAdmin() {
			return isAdmin;
		},
		get adminChecked() {
			return adminChecked;
		}
	};
}

/** Public — fetch the current per-file cap + storage quota (for validation/display). */
export async function loadInstanceLimits(): Promise<InstanceLimits | null> {
	try {
		const body = await idpJson<{ data: InstanceLimits }>('/instance/limits');
		limits = body.data;
		return body.data;
	} catch {
		return null;
	}
}

/** Authed — whether the current session is an instance admin. */
export async function loadAdminStatus(): Promise<boolean> {
	try {
		const body = await idpJson<{ data: { is_admin: boolean } }>('/instance/admin');
		isAdmin = body.data.is_admin;
	} catch {
		isAdmin = false;
	}
	adminChecked = true;
	return isAdmin;
}

/** Admin — update one or both limits; returns (and caches) the new values. */
export async function saveInstanceLimits(patch: InstanceLimitsPatch): Promise<InstanceLimits> {
	const body = await idpJson<{ data: InstanceLimits }>('/instance/limits', {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});
	limits = body.data;
	return body.data;
}

/** Admin — paginated local user table with per-user storage use. */
export async function adminListUsers(params: {
	q?: string;
	role?: 'USER' | 'ADMIN';
	sort?: string;
	order?: 'asc' | 'desc';
	limit: number;
	offset: number;
}): Promise<InstanceUsersPage> {
	const qs = new URLSearchParams();
	if (params.q) qs.set('q', params.q);
	if (params.role) qs.set('role', params.role);
	if (params.sort) qs.set('sort', params.sort);
	if (params.order) qs.set('order', params.order);
	qs.set('limit', String(params.limit));
	qs.set('offset', String(params.offset));
	return idpJson<InstanceUsersPage>(`/instance/users?${qs.toString()}`);
}

/** Admin — browse a specific user's library files (all folders), paginated. */
export async function adminListUserFiles(
	did: string,
	params: { search?: string; sort?: string; order?: 'asc' | 'desc'; limit: number; offset: number }
): Promise<OwnedUploadsPage> {
	const qs = new URLSearchParams();
	if (params.search) qs.set('search', params.search);
	if (params.sort) qs.set('sort', params.sort);
	if (params.order) qs.set('order', params.order);
	qs.set('limit', String(params.limit));
	qs.set('offset', String(params.offset));
	return idpJson<OwnedUploadsPage>(
		`/instance/users/${encodeURIComponent(did)}/files?${qs.toString()}`
	);
}
