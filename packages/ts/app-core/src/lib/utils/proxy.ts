/**
 * Federated media proxy helpers.
 *
 * All remote (cross-origin) URLs rendered in the UI or fetched via `fetch()`
 * should be wrapped with `proxied()` so the browser talks to syren's backend
 * instead of hitting the remote syr instance directly. That keeps the remote
 * from logging end-user IPs on every avatar / emoji / story / profile load.
 *
 * Same-origin and relative URLs pass through untouched.
 */

import { apiUrl, getHost } from '../host';

export function proxied(url: string | null | undefined): string {
	if (!url) return '';
	// Already-relative API paths from our own backend pass through.
	if (url.startsWith('/api')) return getHost() ? `${getHost()}${url}` : url;
	if (url.startsWith('/')) return url;
	if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return url;
	return apiUrl(`/proxy?url=${encodeURIComponent(url)}`);
}

export function proxyInfoUrl(url: string): string {
	return apiUrl(`/proxy/info?url=${encodeURIComponent(url)}`);
}

export interface ProxyInfo {
	ok: boolean;
	status: number;
	size: number | null;
	content_type: string | null;
	max: number;
	exceeds_cap: boolean | null;
	host: string;
}

export async function fetchProxyInfo(url: string): Promise<ProxyInfo | null> {
	try {
		const res = await fetch(proxyInfoUrl(url), { credentials: 'include' });
		if (!res.ok) return null;
		return (await res.json()) as ProxyInfo;
	} catch {
		return null;
	}
}

export function originHost(url: string | null | undefined): string {
	if (!url) return '';
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
