import { describe, expect, it, vi } from 'vitest';
import { RecordId } from 'surrealdb';
import { Permissions, stringToRecordId } from '@slyng/types';
import { MemberAccessService } from './member-access.service';
import type { ChannelRepository, ChannelCategoryRepository } from '../channel/channel.repository';
import type {
	ServerRepository,
	ServerMemberRepository,
	ServerBanRepository,
	ServerRoleRepository
} from '../server/server.repository';
import type {
	PermissionOverrideRepository,
	PermissionOverrideRow
} from '../permission-override/override.repository';

/**
 * `canReadChannels` is the authorisation path the batching rewrote, and this
 * covers what the pure-function suites cannot reach — above all the join
 * between them: one fold is now resolved per server and replayed per channel,
 * so each channel must be evaluated against its OWN channel and category
 * scope. A suite with no override rows cannot see that, because the fold is
 * constant when nothing is scoped; the two override cases below exist so that
 * a rewrite which ignores the cascade, or hands `forChannel` the wrong scope,
 * fails loudly.
 *
 * The repositories are constructor-injected, so the service is exercised
 * directly with stubs — no Nest module, no SurrealDB.
 */

const S_A = new RecordId('server', 'a');
const S_B = new RecordId('server', 'b');
const CAT_A = new RecordId('channel_category', 'cat-a');
const enc = (r: RecordId) => stringToRecordId.encode(r);

/** Server A, inside category CAT_A. */
const CH_A1 = { id: new RecordId('channel', 'a1'), server_id: S_A, category_id: CAT_A };
/** Server A, uncategorised — the control for every category-scoped assertion. */
const CH_A2 = { id: new RecordId('channel', 'a2'), server_id: S_A, category_id: null };
const CH_B = { id: new RecordId('channel', 'b'), server_id: S_B, category_id: null };
const CH_DM = { id: new RecordId('channel', 'dm'), category_id: null };
const ALL_CHANNELS = [CH_A1, CH_A2, CH_B, CH_DM];

const ALICE = 'did:syr:alice';

const everyoneRole = (server_id: RecordId) => ({
	id: new RecordId('server_role', `${server_id.id}-everyone`),
	server_id,
	position: 0,
	is_default: true,
	permissions_allow: Permissions.READ_MESSAGES.toString(),
	permissions_deny: '0'
});

/** A user-scoped override denying READ_MESSAGES at one scope. */
const denyRead = (
	server_id: RecordId,
	scope_type: 'server' | 'category' | 'channel',
	scope_id: RecordId | null,
	target_id = ALICE
): PermissionOverrideRow => ({
	id: new RecordId('permission_override', `o-${scope_type}-${scope_id?.id ?? 'none'}`),
	server_id,
	scope_type,
	scope_id,
	target_type: 'user',
	target_id,
	allow: '0',
	deny: Permissions.READ_MESSAGES.toString(),
	created_at: new Date(),
	updated_at: new Date()
});

interface StubOptions {
	/** DIDs with an ACTIVE ban, by encoded server id. */
	banned?: Record<string, string[]>;
	/** DIDs with a member row, by encoded server id. `undefined` means everyone. */
	members?: Record<string, string[]>;
	owners?: Record<string, string>;
	/** Encoded server ids whose role read explodes. */
	failRolesFor?: string[];
	/** Override rows, filtered by `server_id` the way the repository does. */
	overrides?: PermissionOverrideRow[];
}

function makeService(opts: StubOptions = {}) {
	const servers = {
		async findById(id: RecordId | string) {
			const key = id instanceof RecordId ? enc(id) : id;
			if (key !== enc(S_A) && key !== enc(S_B)) return null;
			return { id: key === enc(S_A) ? S_A : S_B, owner_id: opts.owners?.[key] ?? 'did:syr:owner' };
		}
	} as unknown as ServerRepository;

	const members = {
		async findOne(f: Record<string, unknown>) {
			const key = enc(f.server_id as RecordId);
			const allowed = opts.members?.[key];
			if (allowed && !allowed.includes(f.user_id as string)) return null;
			return { id: new RecordId('server_member', 'm'), server_id: f.server_id, role_ids: [] };
		}
	} as unknown as ServerMemberRepository;

	const bans = {
		async findOne(f: Record<string, unknown>) {
			const key = enc(f.server_id as RecordId);
			return opts.banned?.[key]?.includes(f.user_id as string)
				? { id: new RecordId('server_ban', 'b'), active: true }
				: null;
		}
	} as unknown as ServerBanRepository;

	const roles = {
		async findMany(f: Record<string, unknown>) {
			const ref = f.server_id as RecordId;
			if (opts.failRolesFor?.includes(enc(ref))) {
				throw new Error('surrealdb: connection reset');
			}
			return [everyoneRole(ref)];
		}
	} as unknown as ServerRoleRepository;

	const findByIds = vi.fn(async (ids: (RecordId | string)[]) => {
		const keys = new Set(ids.map((i) => (i instanceof RecordId ? enc(i) : i)));
		return ALL_CHANNELS.filter((c) => keys.has(enc(c.id)));
	});
	const channels = { findByIds } as unknown as ChannelRepository;

	const overrides = {
		async findMany(f: Record<string, unknown>) {
			const ref = f.server_id as RecordId;
			return (opts.overrides ?? []).filter((o) => enc(o.server_id) === enc(ref));
		}
	} as unknown as PermissionOverrideRepository;

	const svc = new MemberAccessService(
		servers,
		members,
		bans,
		roles,
		channels,
		{} as unknown as ChannelCategoryRepository,
		overrides
	);
	const warn = vi.fn();
	const debug = vi.fn();
	// Captured, not silenced: several cases below assert on warn/debug.
	Object.defineProperty(svc, 'logger', { value: { warn, debug, log: vi.fn(), error: vi.fn() } });
	return { svc, warn, debug, findByIds };
}

const sorted = (s: Set<string>) => [...s].sort();

const ALL_IDS = ALL_CHANNELS.map((c) => enc(c.id));

describe('MemberAccessService.canReadChannels', () => {
	it('allows the channels a member may read', async () => {
		const { svc } = makeService();
		expect(sorted(await svc.canReadChannels(ALICE, [enc(CH_A1.id), enc(CH_B.id)]))).toEqual([
			enc(CH_A1.id),
			enc(CH_B.id)
		]);
	});

	// ── the join: one fold per server, replayed per channel ──────────────────
	//
	// Without these, a `canReadChannels` that ignored the cascade entirely and
	// granted read on every channel of every server the user belongs to would
	// pass the whole suite: with no override rows the fold is constant, so no
	// assertion can tell "evaluated correctly" from "not evaluated at all".

	it('applies a channel-scoped override to that channel only', async () => {
		const { svc } = makeService({ overrides: [denyRead(S_A, 'channel', CH_A1.id)] });
		const allowed = await svc.canReadChannels(ALICE, ALL_IDS);
		// CH_A1 denied; its own server's other channel, the other server, and the
		// DM all unaffected — the deny is scoped to one channel.
		expect(sorted(allowed)).toEqual([enc(CH_A2.id), enc(CH_B.id), enc(CH_DM.id)]);
	});

	it('applies a category-scoped override to the channels in that category only', async () => {
		const { svc } = makeService({ overrides: [denyRead(S_A, 'category', CAT_A)] });
		const allowed = await svc.canReadChannels(ALICE, ALL_IDS);
		// CH_A1 is in CAT_A and is denied; CH_A2 is on the SAME server with no
		// category and is not. That difference only appears if each channel is
		// replayed against its own category scope.
		expect(sorted(allowed)).toEqual([enc(CH_A2.id), enc(CH_B.id), enc(CH_DM.id)]);
	});

	it('keeps one server’s overrides out of another server’s fold', async () => {
		// Same category id shape, but owned by server A: server B must not see it.
		const { svc } = makeService({ overrides: [denyRead(S_A, 'server', null)] });
		const allowed = await svc.canReadChannels(ALICE, ALL_IDS);
		expect(sorted(allowed)).toEqual([enc(CH_B.id), enc(CH_DM.id)]);
	});

	// ── membership, bans, ownership, faults ──────────────────────────────────

	it('denies a channel id with no row, and logs the drift', async () => {
		const { svc, debug } = makeService();
		const allowed = await svc.canReadChannels(ALICE, ['channel:ghost', enc(CH_A1.id)]);
		expect(sorted(allowed)).toEqual([enc(CH_A1.id)]);
		expect(allowed.has('channel:ghost')).toBe(false);
		expect(debug).toHaveBeenCalledOnce();
		expect(debug.mock.calls[0][0]).toContain('channel:ghost');
	});

	it('passes DM channels through — no server scope, nothing to gate on', async () => {
		const { svc } = makeService();
		expect(sorted(await svc.canReadChannels(ALICE, [enc(CH_DM.id)]))).toEqual([enc(CH_DM.id)]);
	});

	it('denies every channel of a server the user is banned from', async () => {
		const { svc } = makeService({ banned: { [enc(S_A)]: [ALICE] } });
		const allowed = await svc.canReadChannels(ALICE, ALL_IDS);
		// Server B and the DM are unaffected — the ban is scoped to server A.
		expect(sorted(allowed)).toEqual([enc(CH_B.id), enc(CH_DM.id)]);
	});

	it('denies every channel of a server the user is not a member of', async () => {
		const { svc } = makeService({ members: { [enc(S_A)]: ['did:syr:bob'] } });
		expect(sorted(await svc.canReadChannels(ALICE, [enc(CH_A1.id), enc(CH_B.id)]))).toEqual([
			enc(CH_B.id)
		]);
	});

	it('allows an owner everything, without consulting roles', async () => {
		const { svc } = makeService({
			owners: { [enc(S_A)]: ALICE },
			// The owner short-circuit must land before this would throw.
			failRolesFor: [enc(S_A)],
			// …and must outrank a deny that would otherwise apply.
			overrides: [denyRead(S_A, 'channel', CH_A1.id)]
		});
		expect(sorted(await svc.canReadChannels(ALICE, [enc(CH_A1.id)]))).toEqual([enc(CH_A1.id)]);
	});

	it('isolates a failing server: its channels are denied, everything else survives', async () => {
		const { svc, warn } = makeService({ failRolesFor: [enc(S_A)] });
		const allowed = await svc.canReadChannels(ALICE, ALL_IDS);
		expect(sorted(allowed)).toEqual([enc(CH_B.id), enc(CH_DM.id)]);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain(enc(S_A));
	});

	it('does not let a non-Error thrown value escape the per-server guard', async () => {
		// `(err as Error).message` on a thrown null raises inside the catch and
		// takes out the whole batch the catch exists to save.
		const { svc, warn } = makeService();
		vi.spyOn(
			svc as unknown as { foldForServer: () => Promise<never> },
			'foldForServer'
		).mockRejectedValue(null);

		const allowed = await svc.canReadChannels(ALICE, [enc(CH_A1.id), enc(CH_DM.id)]);
		expect(sorted(allowed)).toEqual([enc(CH_DM.id)]);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('short-circuits an empty request before reading any channel row', async () => {
		const { svc, findByIds } = makeService();
		expect([...(await svc.canReadChannels(ALICE, []))]).toEqual([]);
		expect(findByIds).not.toHaveBeenCalled();
	});
});
