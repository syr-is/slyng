import { redirect } from '@sveltejs/kit';
import { setHost } from '@syren/app-core/host';
import { getStoredHost } from '$lib/host-store';

export const ssr = false;
export const prerender = false;

export const load = async ({ url }: { url: URL }) => {
	const host = await getStoredHost();
	if (host) {
		setHost(host);
	} else if (url.pathname !== '/setup') {
		throw redirect(307, `/setup?return=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return { host };
};
