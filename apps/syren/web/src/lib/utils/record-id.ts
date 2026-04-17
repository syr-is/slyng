/**
 * Coerce SurrealDB-flavoured ID values into the canonical "table:id" string.
 *
 *   "server:abc"             → "server:abc"
 *   { tb: "server", id: a }  → "server:abc"
 *   anything else             → null
 *
 * Backstop for WS payloads that bypassed the gateway's serializer (or for any
 * future broadcast that ships a raw RecordId-shaped object). Frontend matchers
 * compare against the canonical string the HTTP layer already hands them.
 */
export function recordIdString(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const obj = value as { tb?: unknown; id?: unknown };
		if (
			typeof obj.tb === 'string' &&
			(typeof obj.id === 'string' || typeof obj.id === 'number')
		) {
			return `${obj.tb}:${obj.id}`;
		}
	}
	return null;
}
