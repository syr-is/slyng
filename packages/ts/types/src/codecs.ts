import { z } from 'zod';
import { RecordId } from 'surrealdb';
import { ulid } from 'ulid';

/**
 * Zod Codecs
 * Bi-directional transformations for data serialization/deserialization
 * Based on Zod v4 codec patterns: https://zod.dev/codecs
 */

/**
 * SurrealDB RecordId Codec
 * Converts strings to RecordId objects for database storage
 * Format: "table:id" (e.g., "server:abc123", "channel:xyz789")
 * Network (string) -> decode -> RecordId (DB)
 * DB (RecordId) -> encode -> string (Network)
 *
 * ⚠️ Simple (string-id) records only. Composite/owned records
 * (`table:{ created_by, id }`) never round-trip through this codec — use
 * `recordIdFromDidAndLocal` to rebuild them from URL params instead.
 */
export const stringToRecordId = z.codec(z.string(), z.instanceof(RecordId), {
	decode: (str) => {
		const [table, ...rest] = str.split(':');
		return new RecordId(table, rest.join(':'));
	},
	encode: (recordId) => `${recordId.tb}:${recordId.id}`
});

/**
 * ISO datetime string to Date codec
 */
export const isoDatetimeToDate = z.codec(z.string(), z.date(), {
	decode: (str) => new Date(str),
	encode: (date) => date.toISOString()
});

// ---------------------------------------------------------------------------
// Composite Record IDs (DID-based ownership)
//
// Ported from syr (packages/ts/types/src/codecs.ts). Owned content —
// stories, posts, emojis, uploads — keys on `table:{ created_by: <did>, id:
// <ulid> }` so the record is portable across instances (export/import keeps
// the same key). Queried in SurrealQL via `id.created_by = $did`; the ULID
// half is exposed on the wire as `local_id` and rebuilt from URL params with
// `recordIdFromDidAndLocal`.
// ---------------------------------------------------------------------------

interface CompositeId {
	created_by: string;
	id: string;
}

/**
 * Create a RecordId with an embedded DID owner and optional ULID.
 * Format: `table:{ created_by: "did:syr:...", id: "<ulid>" }`
 */
export function createOwnedRecordId(table: string, did: string, localId?: string): RecordId {
	return new RecordId(table, { created_by: did, id: localId ?? ulid() });
}

/**
 * Reconstruct a composite RecordId from a full DID and a local ID.
 * Used in route handlers to rebuild the key from URL params.
 */
export function recordIdFromDidAndLocal(table: string, did: string, localId: string): RecordId {
	return new RecordId(table, { created_by: did, id: localId });
}

function assertCompositeRecordId(recordId: RecordId): void {
	const obj = recordId?.id;
	if (typeof obj !== 'object' || obj === null) {
		throw new Error(
			`Expected composite RecordId (object with created_by and id), got: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}`
		);
	}
	const o = obj as Record<string, unknown>;
	if (typeof o.created_by !== 'string' || typeof o.id !== 'string') {
		throw new Error(
			`Expected composite RecordId (created_by, id), got keys: ${Object.keys(o).join(', ')}`
		);
	}
}

/**
 * Extract the ULID portion from a composite RecordId.
 * @throws If recordId.id is not an object with created_by and id.
 */
export function extractLocalId(recordId: RecordId): string {
	assertCompositeRecordId(recordId);
	return (recordId.id as unknown as CompositeId).id;
}

/**
 * Extract the full DID string from a composite RecordId.
 * @throws If recordId.id is not an object with created_by and id.
 */
export function extractDid(recordId: RecordId): string {
	assertCompositeRecordId(recordId);
	return (recordId.id as unknown as CompositeId).created_by;
}

/**
 * Build a URL path segment from a composite RecordId.
 * Returns `${prefix}/${did}/${localId}`.
 */
export function buildResourceUrl(prefix: string, recordId: RecordId): string {
	return `${prefix}/${extractDid(recordId)}/${extractLocalId(recordId)}`;
}

/**
 * Canonical `${did}/${localId}` path for an owned resource, whether it
 * arrives API-serialized (explicit `did`/`local_id`) or as a composite
 * RecordId object. Used to build `/api/.../:did/:id` fetch URLs.
 */
export function ownedResourcePath(resource: {
	id: RecordId | string;
	did?: string;
	local_id?: string;
}): string {
	if (resource.did && resource.local_id) return `${resource.did}/${resource.local_id}`;
	if (typeof resource.id === 'string') return resource.id;
	return `${extractDid(resource.id)}/${extractLocalId(resource.id)}`;
}

export { ulid } from 'ulid';
