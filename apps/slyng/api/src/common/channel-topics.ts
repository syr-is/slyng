import type { RecordId } from 'surrealdb';
import { stringToRecordId } from '@slyng/types';

/**
 * Getting a batch of channel topics to the point where a permission cascade can
 * answer them: pairing each requested id with the row it resolved to and
 * bucketing those rows by the server whose permissions decide them.
 *
 * Split out of `ChatGateway` and `MemberAccessService.canReadChannels` so the
 * parts the batching introduced — which channel is answered by which server's
 * cascade, and which ids are answered without one — are pure functions with no
 * socket and no repositories behind them, exercised directly rather than
 * inferred from an end-to-end result.
 *
 * Getting the ids *off the wire* is not here: the dispatch switch already
 * element-checks them against the generated contract via `parseListField`
 * (`gateway/ws-payloads.ts`), so a second parser at this layer would be the
 * drifting duplicate this module exists to avoid.
 *
 * Deliberately free of NestJS and DI, like `./permission-fold`.
 */

/**
 * True for a topic naming a channel rather than a server.
 *
 * One predicate, because two callers classify topics — `ChatGateway`
 * partitions a SUBSCRIBE frame with it and `MemberAccessService.resolveServerId`
 * branches on it — and a batch authorised as channels while the loop treats one
 * of them as something else is precisely the disagreement worth designing out.
 */
export function isChannelTopic(topicId: string): boolean {
	return topicId.startsWith('channel:');
}


/** The `channel` columns the grouping reads. */
export interface ChannelScopeRow {
	id: RecordId;
	/** Absent for DM channels (`type: 'direct'`), which have no server scope. */
	server_id?: RecordId;
	category_id?: RecordId | null;
	/**
	 * Soft-delete flag. Optional, and absent is *not* deleted: the column
	 * postdates the rows created before soft-delete existed, which is why
	 * `ChannelRepository.findLiveByServer` matches `deleted = NONE OR
	 * deleted = false` rather than `deleted = false`. Only an explicit `true`
	 * excludes a row.
	 */
	deleted?: boolean;
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
	 * Requested ids with no matching *live* row — no row at all, or one that is
	 * soft-deleted. Denied by omission from the other two buckets; returned so
	 * callers can log the drift, since a client asking about channels that no
	 * longer exist is worth seeing.
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
		// A soft-deleted channel is answered exactly like a missing one. The
		// rows arrive from `findByIds`, whose `WHERE id IN $ids` carries no
		// soft-delete predicate, so without this a deleted channel would still
		// be grouped and its server's fold could grant READ_MESSAGES on it.
		if (!row || row.deleted === true) {
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
