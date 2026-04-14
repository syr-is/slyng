import { z } from 'zod';
import { RecordId } from 'surrealdb';

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
