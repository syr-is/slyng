/**
 * Identity import / export client (P11). Export streams a signed `.zip` the
 * browser saves; import ships a bundle back as multipart form-data. All calls
 * go through `idpFetch` (session cookie + Bearer, `credentials: 'include'`).
 */

import { idpFetch, idpJson } from '../idp-fetch.js';
import { apiUrl } from '../host.js';
import type { IdentityExportInfo, IdentityImportResult } from '@slyng/types';

async function errorFrom(res: Response, fallback: string): Promise<string> {
	const body = (await res.json().catch(() => null)) as
		| { message?: string; error_description?: string }
		| null;
	return body?.message ?? body?.error_description ?? `${fallback} (${res.status})`;
}

/** Whether the export will be custodial-signed (needs a password) or an unsigned
 * data-only bundle (self-custody). Lets the UI decide whether to prompt. */
export async function getExportInfo(): Promise<IdentityExportInfo> {
	return idpJson<IdentityExportInfo>('/identity/export-info');
}

/**
 * Download an export bundle. A custodial (password) account passes its password
 * so the root seed SIGNS the bundle; a self-custody account passes nothing and
 * gets an explicit unsigned, data-only bundle.
 */
export async function exportIdentity(password?: string): Promise<void> {
	const res = await idpFetch('/identity/export', {
		method: 'POST',
		body: JSON.stringify(password ? { password } : {})
	});
	if (!res.ok) throw new Error(await errorFrom(res, 'Export failed'));

	const blob = await res.blob();
	const cd = res.headers.get('Content-Disposition') ?? '';
	const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'slyng-identity.zip';
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Restore/merge a bundle into the signed-in account. */
export async function importIdentity(file: File): Promise<IdentityImportResult> {
	const fd = new FormData();
	fd.append('file', file);
	const res = await idpFetch('/identity/import', { method: 'POST', body: fd });
	if (!res.ok) throw new Error(await errorFrom(res, 'Import failed'));
	return (await res.json()) as IdentityImportResult;
}

/**
 * Create a brand-new account from an export bundle (identity migration). This
 * is pre-session, so it hits the API directly with the cookie flowing; the
 * response sets the session cookie and returns a bridge token for the WASM
 * client, exactly like local register/login.
 */
export async function registerWithImport(params: {
	file: File;
	username: string;
	password: string;
	inviteCode?: string;
}): Promise<{ bridge: string; did: string; imported: IdentityImportResult }> {
	const fd = new FormData();
	fd.append('file', params.file);
	fd.append('username', params.username);
	fd.append('password', params.password);
	if (params.inviteCode) fd.append('invite_code', params.inviteCode);

	const res = await fetch(apiUrl('/auth/register-with-import'), {
		method: 'POST',
		credentials: 'include',
		body: fd
	});
	if (!res.ok) throw new Error(await errorFrom(res, 'Import registration failed'));
	return (await res.json()) as { bridge: string; did: string; imported: IdentityImportResult };
}
