/**
 * Normalise a host URL the user typed into a form.
 *
 * Rules:
 * - Trim and strip trailing slashes.
 * - User-explicit `http://` or `https://` is always preserved (so
 *   http://localhost works for dev).
 * - Bare hosts default to `http://` for localhost / loopback / `*.local`
 *   / RFC1918 LAN addresses, and `https://` for everything else.
 */
export function normalizeHost(input: string): string {
	let s = input.trim().replace(/\/+$/, '');
	if (!s) return '';
	if (/^https?:\/\//i.test(s)) return s;
	const host = s.split('/')[0].split(':')[0].toLowerCase();
	return `${isLocalHost(host) ? 'http' : 'https'}://${s}`;
}

function isLocalHost(host: string): boolean {
	return (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host.endsWith('.local') ||
		host.endsWith('.localhost') ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host)
	);
}

/** True if the string parses as an absolute URL after normalisation. */
export function isValidHost(normalized: string): boolean {
	try {
		new URL(normalized);
		return true;
	} catch {
		return false;
	}
}
