import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WsSubscribePayloadSchema, WsIdentifyPayloadSchema } from '@slyng/types';
import { parseFrame, parseListField } from './ws-payloads';

/**
 * The element contract the dispatch switch passes for the topic-bearing ops,
 * read off the generated schema exactly as `chat.gateway.ts` reads it rather
 * than restated as `z.string()`.
 */
const CHANNEL_TOPIC_ID = WsSubscribePayloadSchema.shape.channel_ids.element;

describe('parseListField', () => {
	it('passes a well-formed frame through and reports nothing salvaged', () => {
		const r = parseListField({ channel_ids: ['channel:a', 'server:s1'] }, 'channel_ids', CHANNEL_TOPIC_ID, {
			optional: false
		});
		expect(r).toEqual({
			ok: true,
			value: { items: ['channel:a', 'server:s1'], offered: 2, absent: false }
		});
	});

	it('accepts an empty list without confusing it for an absent field', () => {
		const r = parseListField({ channel_ids: [] }, 'channel_ids', CHANNEL_TOPIC_ID, {
			optional: false
		});
		expect(r).toEqual({ ok: true, value: { items: [], offered: 0, absent: false } });
	});

	// Each of these reached `.filter` / `for…of` before validation existed and
	// rejected out of a fire-and-forget dispatch, taking the process with it.
	it('salvages the valid entries of a frame carrying bad ones, and reports the shortfall', () => {
		expect(
			parseListField({ channel_ids: [123, 'channel:ok'] }, 'channel_ids', CHANNEL_TOPIC_ID, {
				optional: false
			})
		).toEqual({ ok: true, value: { items: ['channel:ok'], offered: 2, absent: false } });

		expect(
			parseListField(
				{ channel_ids: [null, 'channel:ok', {}, true, undefined] },
				'channel_ids',
				CHANNEL_TOPIC_ID,
				{ optional: false }
			)
		).toEqual({ ok: true, value: { items: ['channel:ok'], offered: 5, absent: false } });
	});

	it('rejects a required field that carries no array to salvage', () => {
		for (const payload of [
			{ channel_ids: 'channel:abc' },
			{ channel_ids: 42 },
			{ channel_ids: {} }
		]) {
			const r = parseListField(payload, 'channel_ids', CHANNEL_TOPIC_ID, { optional: false });
			expect(r.ok).toBe(false);
		}
	});

	it('rejects a required field that is missing or null', () => {
		for (const payload of [{}, { channel_ids: null }, null, undefined]) {
			const r = parseListField(payload, 'channel_ids', CHANNEL_TOPIC_ID, { optional: false });
			expect(r).toEqual({ ok: false, reason: 'channel_ids: required' });
		}
	});

	it('rejects a payload that is not an object at all', () => {
		for (const payload of [0, '', 'nope', true, [], [1, 2]]) {
			const r = parseListField(payload, 'channel_ids', CHANNEL_TOPIC_ID, { optional: false });
			expect(r).toEqual({ ok: false, reason: 'payload is not an object' });
		}
	});

	// UNWATCH_PROFILES is the one op where absent and empty differ: absent drops
	// every watch the socket holds, `[]` drops none. `{"op":51,"d":null}` is the
	// frame the Rust client actually sends for "drop everything".
	it('distinguishes an absent optional field from an empty list', () => {
		const absent = parseListField(null, 'dids', z.string(), { optional: true });
		expect(absent).toEqual({ ok: true, value: { items: [], offered: 0, absent: true } });

		const empty = parseListField({ dids: [] }, 'dids', z.string(), { optional: true });
		expect(empty).toEqual({ ok: true, value: { items: [], offered: 0, absent: false } });
	});

	it('still rejects a non-array optional field rather than treating it as absent', () => {
		const r = parseListField({ dids: 5 }, 'dids', z.string(), { optional: true });
		expect(r).toEqual({ ok: false, reason: 'dids: expected array' });
	});
});

describe('parseFrame', () => {
	it('returns the parsed value for a frame that matches its contract', () => {
		expect(parseFrame(WsIdentifyPayloadSchema, { token: 'sess-abc' })).toEqual({
			ok: true,
			value: { token: 'sess-abc' }
		});
	});

	// `d: null` on IDENTIFY is the exact frame that used to exit the process.
	it('rejects rather than normalising a null or absent payload', () => {
		for (const d of [null, undefined]) {
			expect(parseFrame(WsIdentifyPayloadSchema, d).ok).toBe(false);
		}
	});

	it('never puts the payload in the failure reason', () => {
		// IDENTIFY carries a session token; PRESENCE_UPDATE carries user-authored
		// text. Zod names the type it received, not the value — this asserts that
		// property holds for the schemas actually routed through here.
		const secret = 'super-secret-session-token';
		const r = parseFrame(WsIdentifyPayloadSchema, { token: { nested: secret } });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).not.toContain(secret);
	});
});
