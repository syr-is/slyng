import { describe, it, expect } from 'vitest';
import type {
	Server,
	Channel,
	ChannelCategory,
	ServerRole,
	ServerMember,
	Message,
	DmChannelSummary,
	UserResolveResult
} from '@slyng/client';
import {
	normalizeServer,
	normalizeChannel,
	normalizeCategory,
	normalizeRole,
	normalizeMember,
	normalizeMessage,
	normalizeDmChannel,
	normalizeResolvedUser
} from '../normalize';

/**
 * Fully-populated tsify fixtures — what a real API response carries. The
 * "retains functionality" tests feed these through and assert nothing changes,
 * which is the guarantee that wiring these normalizers into the store setters
 * does not alter behavior for the data the app actually receives today. The
 * "defaults" tests then omit a single drifted optional to prove the fill-in.
 */
const fullServer: Server = {
	id: 'server:1',
	name: 'My Server',
	icon_url: 'https://cdn/i.png',
	banner_url: 'https://cdn/b.png',
	invite_background_url: 'https://cdn/ib.png',
	description: 'a place',
	owner_id: 'did:syr:owner',
	member_count: 42,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z'
};

const fullChannel: Channel = {
	id: 'channel:1',
	type: 'text',
	name: 'general',
	topic: 'hello',
	server_id: 'server:1',
	category_id: 'category:1',
	position: 3,
	created_by: 'did:syr:owner',
	last_message_at: '2026-01-03T00:00:00Z',
	deleted: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z',
	my_permissions: '255'
};

const fullCategory: ChannelCategory = {
	id: 'category:1',
	server_id: 'server:1',
	name: 'Text Channels',
	position: 2,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z'
};

const fullRole: ServerRole = {
	id: 'role:1',
	server_id: 'server:1',
	name: 'Admin',
	color: '#ff0000',
	position: 5,
	permissions: '255',
	is_default: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z'
};

const fullMember: ServerMember = {
	id: 'member:1',
	server_id: 'server:1',
	user_id: 'did:syr:user',
	nickname: 'Nick',
	role_ids: ['role:1', 'role:2'],
	joined_at: '2026-01-01T00:00:00Z',
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z',
	syr_instance_url: 'https://home.example'
};

const fullMessage: Message = {
	id: 'message:1',
	channel_id: 'channel:1',
	sender_id: 'did:syr:user',
	type: 'text',
	content: 'hi there',
	reply_to: ['message:0'],
	attachments: [],
	embeds: [],
	reactions: [],
	pinned: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-02T00:00:00Z'
};

describe('normalizeServer', () => {
	it('retains every field of a complete server unchanged', () => {
		expect(normalizeServer(fullServer)).toEqual(fullServer);
	});

	it('defaults member_count to 0 when the wire omits it', () => {
		const { member_count: _omit, ...rest } = fullServer;
		expect(normalizeServer(rest as Server).member_count).toBe(0);
	});

	it('keeps an explicit member_count of 0 (does not treat 0 as missing)', () => {
		expect(normalizeServer({ ...fullServer, member_count: 0 }).member_count).toBe(0);
	});
});

describe('normalizeChannel', () => {
	it('retains every field of a complete channel unchanged', () => {
		expect(normalizeChannel(fullChannel)).toEqual(fullChannel);
	});

	it('defaults position to 0 when the wire omits it', () => {
		const { position: _omit, ...rest } = fullChannel;
		expect(normalizeChannel(rest as Channel).position).toBe(0);
	});

	it('preserves the channel type (needed for downstream switch/render)', () => {
		expect(normalizeChannel(fullChannel).type).toBe('text');
	});
});

describe('normalizeCategory', () => {
	it('retains every field of a complete category unchanged', () => {
		expect(normalizeCategory(fullCategory)).toEqual(fullCategory);
	});

	it('defaults position to 0 when the wire omits it', () => {
		const { position: _omit, ...rest } = fullCategory;
		expect(normalizeCategory(rest as ChannelCategory).position).toBe(0);
	});
});

describe('normalizeRole', () => {
	it('retains every field of a complete role unchanged', () => {
		expect(normalizeRole(fullRole)).toEqual(fullRole);
	});

	it('defaults color to null, position to 0, permissions to "0" when omitted', () => {
		const { color: _c, position: _p, permissions: _perm, ...rest } = fullRole;
		const out = normalizeRole(rest as ServerRole);
		expect(out.color).toBeNull();
		expect(out.position).toBe(0);
		expect(out.permissions).toBe('0');
	});

	it('produces a numeric position so setRoles can sort without NaN', () => {
		const { position: _omit, ...rest } = fullRole;
		const a = normalizeRole({ ...(rest as ServerRole), id: 'a' });
		const b = normalizeRole({ ...fullRole, id: 'b', position: 7 });
		const sorted = [a, b].sort((x, y) => y.position - x.position);
		expect(sorted.map((r) => r.id)).toEqual(['b', 'a']);
	});
});

describe('normalizeMember', () => {
	it('retains every field of a complete member unchanged', () => {
		expect(normalizeMember(fullMember)).toEqual(fullMember);
	});

	it('returns a fresh object (not the same reference)', () => {
		expect(normalizeMember(fullMember)).not.toBe(fullMember);
	});

	it('preserves role_ids for permission resolution', () => {
		expect(normalizeMember(fullMember).role_ids).toEqual(['role:1', 'role:2']);
	});
});

describe('normalizeMessage', () => {
	it('retains every field of a complete message unchanged', () => {
		expect(normalizeMessage(fullMessage)).toEqual(fullMessage);
	});

	it('defaults type to "text" when the wire omits it', () => {
		const { type: _omit, ...rest } = fullMessage;
		expect(normalizeMessage(rest as Message).type).toBe('text');
	});

	it('preserves a non-default type', () => {
		expect(normalizeMessage({ ...fullMessage, type: 'system' }).type).toBe('system');
	});

	it('is idempotent — re-normalizing an already-normalized message is a no-op', () => {
		const once = normalizeMessage(fullMessage);
		const twice = normalizeMessage(once);
		expect(twice).toEqual(once);
	});

	it('accepts an already-normalized MessageData (the pagination merge path)', () => {
		// [...older(Message), ...current(MessageData)] flows back through the
		// setter, so normalizeMessage must handle both shapes.
		const asData = normalizeMessage(fullMessage);
		expect(normalizeMessage(asData).content).toBe('hi there');
	});

	it('preserves content and attachments (no data loss on normalize)', () => {
		const attachment = { url: 'u', filename: 'f.png', mime_type: 'image/png', size: 10 };
		const withPayload: Message = { ...fullMessage, content: 'x', attachments: [attachment] };
		const out = normalizeMessage(withPayload);
		expect(out.content).toBe('x');
		expect(out.attachments).toEqual([attachment]);
	});
});

describe('normalizeDmChannel', () => {
	const fullDm: DmChannelSummary = {
		id: 'dm:1',
		type: 'direct',
		last_message_at: '2026-01-03T00:00:00Z',
		other_user_id: 'did:syr:other',
		other_user_instance_url: 'https://home.example',
		is_blocked: true,
		is_ignored: false
	};

	it('retains a complete DM channel unchanged', () => {
		expect(normalizeDmChannel(fullDm)).toEqual(fullDm);
	});

	it('defaults other_user_id to null and the flags to false when omitted', () => {
		const { other_user_id: _o, is_blocked: _b, is_ignored: _i, ...rest } = fullDm;
		const out = normalizeDmChannel(rest as DmChannelSummary);
		expect(out.other_user_id).toBeNull();
		expect(out.is_blocked).toBe(false);
		expect(out.is_ignored).toBe(false);
	});
});

describe('normalizeResolvedUser', () => {
	it('retains a complete resolve result unchanged', () => {
		const u: UserResolveResult = {
			did: 'did:syr:x',
			syr_instance_url: 'https://home.example',
			registered: true
		};
		expect(normalizeResolvedUser(u)).toEqual(u);
	});

	it('narrows a missing syr_instance_url to null', () => {
		const u: UserResolveResult = { did: 'did:syr:x', registered: false };
		expect(normalizeResolvedUser(u).syr_instance_url).toBeNull();
	});
});
