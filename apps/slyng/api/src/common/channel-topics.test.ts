import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import { stringToRecordId } from '@slyng/types';
import { groupChannelTopicsByServer, parseTopicIds, type ChannelScopeRow } from './channel-topics';

const S1 = new RecordId('server', 's1');
const S2 = new RecordId('server', 's2');
const CAT = new RecordId('channel_category', 'text');

const chan = (
	id: string,
	server_id?: RecordId,
	category_id?: RecordId | null
): ChannelScopeRow => ({
	id: new RecordId('channel', id),
	server_id,
	category_id
});

const id = (name: string) => stringToRecordId.encode(new RecordId('channel', name));

describe('parseTopicIds', () => {
	it('passes a well-formed frame through and reports it on-contract', () => {
		expect(parseTopicIds({ channel_ids: ['channel:a', 'server:s1'] })).toEqual({
			ids: ['channel:a', 'server:s1'],
			offered: 2,
			offContract: false
		});
		expect(parseTopicIds({ channel_ids: [] })).toEqual({
			ids: [],
			offered: 0,
			offContract: false
		});
	});

	// Each of these reached `.filter` / `for…of` before the parse existed and
	// rejected out of a fire-and-forget dispatch, taking the process with it.
	it('salvages the valid entries of a frame with a bad one, and flags it', () => {
		expect(parseTopicIds({ channel_ids: [123, 'channel:ok'] })).toEqual({
			ids: ['channel:ok'],
			offered: 2,
			offContract: true
		});
		expect(parseTopicIds({ channel_ids: [null, 'channel:ok', {}, true, undefined] })).toEqual({
			ids: ['channel:ok'],
			offered: 5,
			offContract: true
		});
	});

	it('yields nothing when there is no array of topics to salvage', () => {
		for (const payload of [
			{ channel_ids: 'channel:abc' },
			{},
			{ channel_ids: null },
			{ channel_ids: 42 }
		]) {
			expect(parseTopicIds(payload)).toEqual({ ids: [], offered: 0, offContract: true });
		}
	});

	it('survives a payload that is not an object at all', () => {
		for (const payload of [undefined, null, 0, '', 'nope', true, [], [1, 2]]) {
			expect(parseTopicIds(payload)).toEqual({ ids: [], offered: 0, offContract: true });
		}
	});
});

describe('groupChannelTopicsByServer', () => {
	it('buckets each channel under the server whose cascade decides it', () => {
		const rows = [chan('a', S1), chan('b', S2), chan('c', S1)];
		const { byServer, unscoped, unresolved } = groupChannelTopicsByServer(
			[id('a'), id('b'), id('c')],
			rows
		);

		expect([...byServer.keys()].sort()).toEqual(['server:s1', 'server:s2']);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('a'), id('c')]);
		expect(byServer.get('server:s2')?.map((c) => c.id)).toEqual([id('b')]);
		expect(unscoped).toEqual([]);
		expect(unresolved).toEqual([]);
	});

	it('carries the category off the row so nothing re-reads that column', () => {
		const { byServer } = groupChannelTopicsByServer(
			[id('a'), id('b')],
			[chan('a', S1, CAT), chan('b', S1, null)]
		);
		expect(byServer.get('server:s1')?.map((c) => c.categoryId)).toEqual([
			'channel_category:text',
			null
		]);
	});

	it('only ever returns an id that equals its row’s encoded id', () => {
		// This is what lets the same string key the cascade's channel scope: a
		// lookup hit proves the two agree, so a channel's overrides cannot be
		// sidestepped by asking under some other spelling of its id.
		const rows = [chan('a', S1), chan('b', S2), chan('dm')];
		const requested = [id('a'), id('b'), id('dm'), 'channel:ghost', 'nocolon'];
		const g = groupChannelTopicsByServer(requested, rows);
		const rowIds = new Set(rows.map((r) => stringToRecordId.encode(r.id)));
		for (const entries of g.byServer.values()) {
			for (const e of entries) expect(rowIds.has(e.id)).toBe(true);
		}
		for (const u of g.unscoped) expect(rowIds.has(u)).toBe(true);
		// and anything that did not match a row is denied, never bucketed
		expect(g.unresolved).toEqual(['channel:ghost', 'nocolon']);
	});

	it('separates rows with no server scope — DM channels gate on nothing', () => {
		const { unscoped, byServer, unresolved } = groupChannelTopicsByServer(
			[id('dm'), id('a')],
			[chan('dm'), chan('a', S1)]
		);
		expect(unscoped).toEqual([id('dm')]);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('a')]);
		expect(unresolved).toEqual([]);
	});

	it('reports ids with no row as unresolved rather than dropping them silently', () => {
		const { unresolved, unscoped, byServer } = groupChannelTopicsByServer(
			[id('ghost'), id('a')],
			[chan('a', S1)]
		);
		// A channel that does not exist is nobody's to read — never `unscoped`,
		// which is the bucket that skips the permission check entirely.
		expect(unresolved).toEqual([id('ghost')]);
		expect(unscoped).toEqual([]);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('a')]);
	});

	it('handles an id whose record half contains colons', () => {
		const weird = 'channel:a:b';
		const rows = [{ id: new RecordId('channel', 'a:b'), server_id: S1 }];
		const { byServer } = groupChannelTopicsByServer([weird], rows);
		expect(byServer.get('server:s1')).toEqual([{ id: weird, categoryId: null }]);
	});

	it('deduplicates repeated ids', () => {
		const { byServer } = groupChannelTopicsByServer([id('a'), id('a'), id('a')], [chan('a', S1)]);
		expect(byServer.get('server:s1')).toHaveLength(1);
	});

	it('returns empty buckets for an empty request', () => {
		const g = groupChannelTopicsByServer([], [chan('a', S1)]);
		expect(g.unscoped).toEqual([]);
		expect(g.unresolved).toEqual([]);
		expect(g.byServer.size).toBe(0);
	});

	it('does not throw on ids that are not well-formed record ids', () => {
		// These can only arrive if a caller skips the gateway's parse, but the
		// grouping must degrade to "unresolved", never throw into an
		// authorisation path.
		const junk = ['', 'nocolon', ':', 'channel:', '::::'];
		const g = groupChannelTopicsByServer(junk, [chan('a', S1)]);
		expect(g.unresolved).toEqual(junk);
		expect(g.unscoped).toEqual([]);
		expect(g.byServer.size).toBe(0);
	});

	it('ignores rows nobody asked for', () => {
		const { byServer, unresolved } = groupChannelTopicsByServer(
			[id('a')],
			[chan('a', S1), chan('unrequested', S1), chan('other', S2)]
		);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('a')]);
		expect(byServer.has('server:s2')).toBe(false);
		expect(unresolved).toEqual([]);
	});
});
