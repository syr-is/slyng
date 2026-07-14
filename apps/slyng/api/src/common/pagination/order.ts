export function normalizeOrder(v: unknown): 'asc' | 'desc' | undefined {
	const raw = Array.isArray(v) ? v[0] : v;
	return raw === 'asc' || raw === 'desc' ? raw : undefined;
}
