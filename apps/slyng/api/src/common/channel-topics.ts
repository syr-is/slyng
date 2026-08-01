import type { RecordId } from 'surrealdb';
import { stringToRecordId, WsSubscribePayloadSchema } from '@slyng/types';

/**
 * Getting a batch of channel topics from the wire to the point where a
 * permission cascade can answer them: parsing the frame that carried them, then
 * pairing each requested id with the row it resolved to and bucketing those
 * rows by the server whose permissions decide them.
 *
 * Split out of `ChatGateway` and `MemberAccessService.canReadChannels` so the
 * parts the batching introduced — which ids survive an untrusted frame, which
 * channel is answered by which server's cascade, and which ids are answered
 * without one — are pure functions with no socket and no repositories behind
 * them, exercised directly rather than inferred from an end-to-end result.
 *
 * Deliberately free of NestJS and DI, like `./permission-fold`.
 */

/**
 * Topic ids out of a SUBSCRIBE / UNSUBSCRIBE frame's `d`.
 *
 * The payload is attacker-controlled and nothing upstream has validated it: the
 * gateway's `@MessageBody()` is an envelope whose `d` is `unknown` by op, so the
 * global `ZodValidationPipe` has no `createZodDto` metatype to fire on. It is
 * parsed here against `WsSubscribePayloadSchema` — the generated wire contract —
 * rather than a hand-rolled shape check, because a second definition of this
 * payload is exactly the kind of drifting duplicate this module exists to avoid,
 * and that schema already existed unused.
 *
 * Parsing is per-entry, not per-frame. The contract is all-or-nothing, but a
 * frame carries many independent topic requests and the per-id loop this
 * replaced denied only the entry that failed. So a frame that misses the
 * contract still yields the entries matching its element type, and a payload
 * with no array to salvage yields nothing. Never throws: it is called from a
 * fire-and-forget dispatch where a rejection takes the process down.
 */
export function parseTopicIds(payload: unknown): string[] {
	const parsed = WsSubscribePayloadSchema.safeParse(payload);
	if (parsed.success) return parsed.data.channel_ids;

	const ids = (payload as { channel_ids?: unknown } | null | undefined)?.channel_ids;
	if (!Array.isArray(ids)) return [];
	const element = WsSubscribePayloadSchema.shape.channel_ids.element;
	return ids.filter((id): id is string => element.safeParse(id).success);
}

/** The `channel` columns the grouping reads. */
export interface ChannelScopeRow {
	id: RecordId;
	/** Absent for DM channels (`type: 'direct'`), which have no server scope. */
	server_id?: RecordId;
	category_id?: RecordId | null;
}

export interface ChannelTopicGrouping {
	/**
	 * Requested ids whose row has no server scope. Nothing gates these — there
	 * is no server whose permissions could apply.
	 */
	unscoped: string[];
	/**
	 * Requested ids that resolved to a server-scoped row, bucketed by encoded
	 * server id. `categoryId` is taken off the row that was already fetched, so
	 * the cascade never re-reads that column.
	 */
	byServer: Map<string, Array<{ id: string; categoryId: string | null }>>;
	/**
	 * Requested ids with no matching row. Callers deny these — a channel that
	 * does not exist is not one anybody may read.
	 */
	unresolved: string[];
}

/** Canonical `tb:id` form, so a caller's id form can't miss a row it did fetch. */
function normalise(id: string): string {
	return stringToRecordId.encode(stringToRecordId.decode(id));
}

export function groupChannelTopicsByServer(
	channelIds: readonly string[],
	rows: readonly ChannelScopeRow[]
): ChannelTopicGrouping {
	const unscoped: string[] = [];
	const unresolved: string[] = [];
	const byServer = new Map<string, Array<{ id: string; categoryId: string | null }>>();

	const rowByKey = new Map<string, ChannelScopeRow>();
	for (const row of rows) rowByKey.set(stringToRecordId.encode(row.id), row);

	// Iterating the request (not the rows) keeps every answer keyed by the exact
	// string the caller passed — which is also the channel-scope key the cascade
	// matches overrides on.
	const seen = new Set<string>();
	for (const id of channelIds) {
		if (seen.has(id)) continue;
		seen.add(id);

		const row = rowByKey.get(normalise(id));
		if (!row) {
			unresolved.push(id);
			continue;
		}
		if (!row.server_id) {
			unscoped.push(id);
			continue;
		}
		const serverId = stringToRecordId.encode(row.server_id);
		const categoryId = row.category_id ? stringToRecordId.encode(row.category_id) : null;
		const bucket = byServer.get(serverId);
		if (bucket) bucket.push({ id, categoryId });
		else byServer.set(serverId, [{ id, categoryId }]);
	}

	return { unscoped, byServer, unresolved };
}
