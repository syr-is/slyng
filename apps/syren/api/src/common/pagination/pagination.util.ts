/**
 * Shared parse helpers for paginated / filter-enabled HTTP endpoints.
 * NestJS query params arrive as `string | string[] | undefined`; these
 * coerce them into usable primitives with sensible fallbacks.
 */

export function parseIntOr(value: unknown, fallback: number): number {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null) return fallback;
	const s = typeof raw === 'string' ? raw : String(raw);
	const n = parseInt(s, 10);
	return Number.isFinite(n) ? n : fallback;
}

export function parseDate(value: unknown): Date | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null || raw === '') return undefined;
	const s = typeof raw === 'string' ? raw : String(raw);
	const d = new Date(s);
	return isNaN(d.getTime()) ? undefined : d;
}

export function firstString(value: unknown): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null) return undefined;
	const s = typeof raw === 'string' ? raw : String(raw);
	return s.length ? s : undefined;
}
