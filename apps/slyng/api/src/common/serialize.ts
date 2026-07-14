/**
 * Recursively encode SurrealDB-flavoured values to JSON-friendly forms:
 *   - Simple RecordId (`{ tb, id }`, `id` primitive) → "tb:id"
 *   - Composite RecordId (`{ tb, id: { created_by, id } }`) → `{ tb, id: {…} }`
 *     kept in object form (owned content — the wire also carries flat
 *     `did`/`local_id` fields, and the frontend `extractDid`/`extractLocalId`
 *     helpers read the nested object directly)
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
		const id = obj.id;
		// Composite/owned RecordId — collapsing to a string would lose the DID
		// half. Keep the object shape (both fields are plain strings).
		if (id !== null && typeof id === 'object') {
			return { tb: obj.tb, id: serializeForWire(id) };
		}
		return `${obj.tb}:${id}`;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = serializeForWire(value);
	}
	return result;
}
