import { z } from 'zod';

/**
 * Checking a client→server frame's `d` against the generated wire contract,
 * for the dispatch switch in `chat.gateway.ts`.
 *
 * `@MessageBody()` hands the gateway an envelope whose `d` is `unknown` — the
 * op decides its shape, so the global `ZodValidationPipe` has no `createZodDto`
 * metatype to fire on and every handler took its payload behind a cast. The
 * schemas that describe those payloads already exist in `@slyng/types`; these
 * helpers are the seam that finally applies them, without a second hand-written
 * definition of any payload drifting alongside the generated one.
 *
 * Two shapes of check, because the ops split cleanly in two:
 *
 * - `parseFrame` — whole-frame parse, for the payloads that are scalars only
 *   (IDENTIFY, TYPING_START, PRESENCE_UPDATE, VOICE_STATE_UPDATE). Each field
 *   has one meaning; there is nothing to salvage out of a frame that misses
 *   one.
 * - `parseListField` — container check plus per-entry salvage, for the frames
 *   that carry a list (SUBSCRIBE, UNSUBSCRIBE, WATCH_PROFILES,
 *   UNWATCH_PROFILES). Those frames batch many independent requests — a whole
 *   server's topic list, a whole roster of profile watches — so failing all of
 *   them over one bad entry costs far more than the entry is worth. The frame's
 *   shape is answered here; which entries survive stays element-level.
 *
 * `parseFrame` returns Zod's parsed value, which strips unknown keys. That is
 * safe for the ops routed through it only because their senders build the
 * payload as a bare object literal of exactly the declared fields — see the
 * per-struct evidence in `packages/rust/slyng-types/src/ws.rs`. An op whose
 * clients pass a wider object through must not be routed through it without
 * re-checking that first. The corollary is that the generated struct has to
 * name every field a client sends: `custom_emoji` on PRESENCE_UPDATE and
 * `has_camera` / `has_screen` on VOICE_STATE_UPDATE were missing from it, and
 * routing those ops through here before fixing that would have silently
 * dropped them.
 */

/** Outcome of checking one frame. `reason` is safe to log — see `describeIssues`. */
export type FrameCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

/** What a list-bearing frame yielded. */
export interface ListField<T> {
	/** Entries that matched the element contract, in wire order. */
	items: T[];
	/** Entries the frame offered. Equal to `items.length` when none were dropped. */
	offered: number;
	/**
	 * The field was absent altogether — distinct from an empty list, and only
	 * reachable when the caller declared it optional. UNWATCH_PROFILES is the
	 * one op where the two differ: absent means "drop every watch this socket
	 * holds", `[]` means "drop nothing".
	 */
	absent: boolean;
}

/**
 * A list-bearing frame's `d` as an object, spelling "no payload" the way this
 * codebase's own client spells it.
 *
 * `slyng-client` sends HEARTBEAT as `{"op":2,"d":null}`
 * (`ws/native.rs:270`, `ws/wasm.rs:195`) and `WsEnvelope` defaults a missing `d`
 * to JSON null, so null is the wire's empty payload rather than a malformed
 * one. The one op that has to keep seeing it that way is UNWATCH_PROFILES:
 * `{"op":51,"d":null}` reached `unregister(client, undefined)` before this
 * change and dropped every watch on the socket, and that has to stay true.
 * The other list ops carry a required field and fail on the missing field
 * either way.
 *
 * Deliberately *not* applied by `parseFrame` — see the note there.
 */
function asBody(d: unknown): unknown {
	return d === null || d === undefined ? {} : d;
}

/** True for a plain JSON object — the only thing a payload can be. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A Zod failure as a log line. Issue paths and messages only — never the input.
 * Zod's messages name the type it received, not the value, so this cannot leak
 * a session token out of a bad IDENTIFY.
 */
export function describeIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 4)
		.map((issue) => {
			const path = issue.path.map((seg) => String(seg)).join('.');
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join('; ');
}

/**
 * Whole-frame parse for the scalar-only payloads.
 *
 * `d` goes to the schema exactly as it arrived — no `asBody` normalisation. For
 * the ops with a required field (IDENTIFY's `token`, TYPING_START's
 * `channel_id`, VOICE_STATE_UPDATE's `channel_id`) that changes nothing: a null
 * `d` fails on the missing field either way. It matters for PRESENCE_UPDATE,
 * whose fields are all optional, and the strict reading is the right one there:
 * every real sender builds an object (`updateMyPresence` forwards a
 * `Partial<PresenceData>`, and `{}` is a legitimate no-op patch), so a null or
 * absent `d` is a frame no client produces. `{"op":6,"d":null}` is in fact the
 * exact frame that used to take the API process down, and it is worth a log
 * line rather than a silent re-broadcast of the sender's current presence.
 *
 * The list ops keep their own normalisation because absent means something
 * there — see `asBody` and `parseListField`.
 */
export function parseFrame<T>(schema: z.ZodType<T>, d: unknown): FrameCheck<T> {
	const parsed = schema.safeParse(d);
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, reason: describeIssues(parsed.error) };
}

/**
 * Container check plus per-entry salvage for a list-bearing payload.
 *
 * Rejects the frame only for what is genuinely un-actionable: a `d` that is not
 * an object, a required field that is missing, a field that is not an array.
 * Past that the list is filtered against `element`, so a client that slips one
 * `undefined` into a roster of fifty still gets the other forty-nine
 * registered. Callers log `offered > items.length` — salvaging silently would
 * turn a client-side regression into a partial subscribe nobody can see.
 */
export function parseListField<T>(
	d: unknown,
	field: string,
	element: z.ZodType<T>,
	opts: { optional: boolean }
): FrameCheck<ListField<T>> {
	const body = asBody(d);
	if (!isRecord(body)) return { ok: false, reason: `payload is not an object` };

	const raw = body[field];
	if (raw === undefined || raw === null) {
		if (!opts.optional) return { ok: false, reason: `${field}: required` };
		return { ok: true, value: { items: [], offered: 0, absent: true } };
	}
	if (!Array.isArray(raw)) return { ok: false, reason: `${field}: expected array` };

	const items: T[] = [];
	for (const entry of raw) {
		const parsed = element.safeParse(entry);
		if (parsed.success) items.push(parsed.data);
	}
	return { ok: true, value: { items, offered: raw.length, absent: false } };
}
