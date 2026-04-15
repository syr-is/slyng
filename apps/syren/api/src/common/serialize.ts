/**
 * Recursively encode SurrealDB-flavoured values to JSON-friendly forms:
 *   - RecordId-shaped objects (`{ tb, id }` with exactly two keys) → "tb:id"
 *   - Date instances → ISO 8601 string
 *   - Arrays + plain objects → walked
 *   - Everything else → returned as-is
 *
 * Used by `RecordIdInterceptor` for HTTP responses AND by the WS gateway's
 * `send()` so both surfaces emit the same wire shape — without it, a SurrealDB
 * RecordId on a broadcast row arrives at the browser as `{tb, id}` and breaks
 * any frontend matcher comparing against the canonical "tb:id" string.
 */
export function serializeForWire(data: unknown): unknown {
	if (data === null || data === undefined) return data;
	if (data instanceof Date) return data.toISOString();

	if (typeof data !== 'object') return data;
	if (Array.isArray(data)) return data.map((item) => serializeForWire(item));

	const obj = data as Record<string, unknown>;

	if ('tb' in obj && 'id' in obj && typeof obj.tb === 'string' && Object.keys(obj).length === 2) {
		return `${obj.tb}:${obj.id}`;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = serializeForWire(value);
	}
	return result;
}
