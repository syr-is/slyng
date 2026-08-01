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

export interface ParsedTopicIds {
	/** Entries that matched the contract's element type. */
	ids: string[];
	/** Entries the frame offered — 0 when it carried no array at all. */
	offered: number;
	/**
	 * The frame did not match the contract as a whole. Callers log this: a
	 * salvaged frame is a silent partial subscribe otherwise, and a client
	 * regression that slips an `undefined` into the array would leave no trace.
	 */
	offContract: boolean;
}

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
 * UNSUBSCRIBE borrows the SUBSCRIBE schema deliberately: `generated.ts` defines
 * no `WsUnsubscribePayloadSchema`, and the two frames carry the same
 * `{ channel_ids }` shape. If they ever diverge on the wire, this is the seam
 * that has to split first.
 *
 * Parsing is per-entry, not per-frame. The contract is all-or-nothing, but a
 * frame carries many independent topic requests and the per-id loop this
 * replaced denied only the entry that failed. So a frame that misses the
 * contract still yields the entries matching its element type, and a payload
 * with no array to salvage yields nothing.
 *
 * Total for every value `JSON.parse` can produce, which is all a WS frame can
 * be (`WsAdapter`'s `messageParser`). It is not proof against a hand-built
 * object with a throwing accessor, which cannot arrive over the wire. That
 * matters because `handleSubscribe` is dispatched fire-and-forget, so a
 * rejection there takes the process down; `handleUnsubscribe` is synchronous
 * and would merely propagate.
 */
export function parseTopicIds(payload: unknown): ParsedTopicIds {
	const parsed = WsSubscribePayloadSchema.safeParse(payload);
	if (parsed.success) {
		return {
			ids: parsed.data.channel_ids,
			offered: parsed.data.channel_ids.length,
			offContract: false
		};
	}

	const raw = (payload as { channel_ids?: unknown } | null | undefined)?.channel_ids;
	if (!Array.isArray(raw)) return { ids: [], offered: 0, offContract: true };

	const element = WsSubscribePayloadSchema.shape.channel_ids.element;
	return {
		ids: raw.filter((id): id is string => element.safeParse(id).success),
		offered: raw.length,
		offContract: true
	};
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
	byServer: Map<string, GroupedChannel[]>;
	/**
	 * Requested ids with no matching row. Denied by omission from the other two
	 * buckets; returned so callers can log the drift, since a client asking
	 * about channels that no longer exist is worth seeing.
	 */
	unresolved: string[];
}

export interface GroupedChannel {
	/**
	 * The requested id, which is also the row's own encoded id — see the lookup
	 * below for why those cannot differ. Callers use it both to key the cascade's
	 * channel scope and to answer the caller.
	 */
	id: string;
	/** Encoded `category_id` off the row, so nothing re-reads that column. */
	categoryId: string | null;
}

export function groupChannelTopicsByServer(
	channelIds: readonly string[],
	rows: readonly ChannelScopeRow[]
): ChannelTopicGrouping {
	const unscoped: string[] = [];
	const unresolved: string[] = [];
	const byServer = new Map<string, GroupedChannel[]>();

	const rowByKey = new Map<string, ChannelScopeRow>();
	for (const row of rows) rowByKey.set(stringToRecordId.encode(row.id), row);

	// Iterate the request, not the rows, so every answer comes back under the
	// string the caller asked with.
	//
	// Ids are looked up exactly as given, against keys built from the rows' own
	// ids — so a hit *is* proof that the requested string equals `encode(row.id)`.
	// That is what makes it safe to use as the cascade's channel-scope key: a
	// channel's overrides cannot be sidestepped by asking under some other
	// spelling, because another spelling would not have matched a row at all.
	// (Normalising with `encode(decode(s))` first would add nothing: it
	// reconstructs `s` for anything with a colon, and turns anything without one
	// into `s:`, which matches no row either way.)
	const seen = new Set<string>();
	for (const id of channelIds) {
		if (seen.has(id)) continue;
		seen.add(id);

		const row = rowByKey.get(id);
		if (!row) {
			unresolved.push(id);
			continue;
		}
		if (!row.server_id) {
			unscoped.push(id);
			continue;
		}
		const serverId = stringToRecordId.encode(row.server_id);
		const entry: GroupedChannel = {
			id,
			categoryId: row.category_id ? stringToRecordId.encode(row.category_id) : null
		};
		const bucket = byServer.get(serverId);
		if (bucket) bucket.push(entry);
		else byServer.set(serverId, [entry]);
	}

	return { unscoped, byServer, unresolved };
}
