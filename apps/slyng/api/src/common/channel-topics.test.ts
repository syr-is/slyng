import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import { stringToRecordId } from '@slyng/types';
import { groupChannelTopicsByServer, isChannelTopic, type ChannelScopeRow } from './channel-topics';

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

	// Unscoped is a bucket, not a verdict: no server fold can answer these, so
	// `MemberAccessService.canReadChannels` gates them on participation instead.
	it('separates rows with no server scope — DM channels, answered elsewhere', () => {
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

	// `findByIds` runs `WHERE id IN $ids` with no soft-delete predicate, so a
	// deleted channel arrives here looking exactly like a live one. If it were
	// grouped, its server's fold could grant READ_MESSAGES on a deleted channel.
	it('treats a soft-deleted channel as unresolved, not as a live one', () => {
		const { unscoped, byServer, unresolved } = groupChannelTopicsByServer(
			[id('gone'), id('dmgone'), id('a')],
			[
				{ ...chan('gone', S1), deleted: true },
				{ ...chan('dmgone'), deleted: true },
				chan('a', S1)
			]
		);
		expect(unresolved).toEqual([id('gone'), id('dmgone')]);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('a')]);
		expect(unscoped).toEqual([]);
	});

	// The column postdates the rows created before soft-delete existed, which is
	// why `findLiveByServer` matches `deleted = NONE OR deleted = false`.
	it('keeps rows where deleted is absent or false', () => {
		const { byServer, unresolved } = groupChannelTopicsByServer(
			[id('legacy'), id('live')],
			[chan('legacy', S1), { ...chan('live', S1), deleted: false }]
		);
		expect(byServer.get('server:s1')?.map((c) => c.id)).toEqual([id('legacy'), id('live')]);
		expect(unresolved).toEqual([]);
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

describe('isChannelTopic', () => {
	it('is true only for channel topics', () => {
		expect(isChannelTopic('channel:abc')).toBe(true);
		expect(isChannelTopic('channel:')).toBe(true);
		expect(isChannelTopic('server:s1')).toBe(false);
		expect(isChannelTopic('')).toBe(false);
		expect(isChannelTopic('nocolon')).toBe(false);
	});
});
