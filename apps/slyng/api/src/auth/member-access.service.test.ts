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
import type { PermissionOverrideRepository } from '../permission-override/override.repository';

/**
 * `canReadChannels` is the authorisation path the batching rewrote, and these
 * are the two behaviours it changed that the pure-function suites cannot reach:
 * a channel topic with no row is denied, and one server's read failing costs
 * that server's channels and nothing else.
 *
 * The repositories are constructor-injected, so the service is exercised
 * directly with stubs — no Nest module, no SurrealDB.
 */

const S_A = new RecordId('server', 'a');
const S_B = new RecordId('server', 'b');
const enc = (r: RecordId) => stringToRecordId.encode(r);

const CH_A = { id: new RecordId('channel', 'a'), server_id: S_A, category_id: null };
const CH_B = { id: new RecordId('channel', 'b'), server_id: S_B, category_id: null };
const CH_DM = { id: new RecordId('channel', 'dm'), category_id: null };

const everyoneRole = (server_id: RecordId) => ({
	id: new RecordId('server_role', `${server_id.id}-everyone`),
	server_id,
	position: 0,
	is_default: true,
	permissions_allow: Permissions.READ_MESSAGES.toString(),
	permissions_deny: '0'
});

interface StubOptions {
	/** DIDs with an ACTIVE ban, by encoded server id. */
	banned?: Record<string, string[]>;
	/** DIDs with a member row, by encoded server id. `undefined` means everyone. */
	members?: Record<string, string[]>;
	owners?: Record<string, string>;
	/** Encoded server ids whose role read explodes. */
	failRolesFor?: string[];
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

	const channels = {
		async findByIds(ids: (RecordId | string)[]) {
			const keys = new Set(ids.map((i) => (i instanceof RecordId ? enc(i) : i)));
			return [CH_A, CH_B, CH_DM].filter((c) => keys.has(enc(c.id)));
		}
	} as unknown as ChannelRepository;

	const overrides = {
		async findMany() {
			return [];
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
	// The service's own Logger would print to stderr on the fault paths below.
	Object.defineProperty(svc, 'logger', { value: { warn, debug, log: vi.fn(), error: vi.fn() } });
	return { svc, warn, debug };
}

const sorted = (s: Set<string>) => [...s].sort();

describe('MemberAccessService.canReadChannels', () => {
	it('allows the channels a member may read', async () => {
		const { svc } = makeService();
		expect(
			sorted(await svc.canReadChannels('did:syr:alice', [enc(CH_A.id), enc(CH_B.id)]))
		).toEqual([enc(CH_A.id), enc(CH_B.id)]);
	});

	it('denies a channel id with no row, and logs the drift', async () => {
		const { svc, debug } = makeService();
		const allowed = await svc.canReadChannels('did:syr:alice', ['channel:ghost', enc(CH_A.id)]);
		expect(sorted(allowed)).toEqual([enc(CH_A.id)]);
		expect(allowed.has('channel:ghost')).toBe(false);
		expect(debug).toHaveBeenCalledOnce();
		expect(debug.mock.calls[0][0]).toContain('channel:ghost');
	});

	it('passes DM channels through — no server scope, nothing to gate on', async () => {
		const { svc } = makeService();
		expect(sorted(await svc.canReadChannels('did:syr:alice', [enc(CH_DM.id)]))).toEqual([
			enc(CH_DM.id)
		]);
	});

	it('denies every channel of a server the user is banned from', async () => {
		const { svc } = makeService({ banned: { [enc(S_A)]: ['did:syr:alice'] } });
		const allowed = await svc.canReadChannels('did:syr:alice', [
			enc(CH_A.id),
			enc(CH_B.id),
			enc(CH_DM.id)
		]);
		// Server B and the DM are unaffected — the ban is scoped to server A.
		expect(sorted(allowed)).toEqual([enc(CH_B.id), enc(CH_DM.id)]);
	});

	it('denies every channel of a server the user is not a member of', async () => {
		const { svc } = makeService({ members: { [enc(S_A)]: ['did:syr:bob'] } });
		expect(
			sorted(await svc.canReadChannels('did:syr:alice', [enc(CH_A.id), enc(CH_B.id)]))
		).toEqual([enc(CH_B.id)]);
	});

	it('allows an owner everything, without consulting roles', async () => {
		const { svc } = makeService({
			owners: { [enc(S_A)]: 'did:syr:alice' },
			// The owner short-circuit must land before this would throw.
			failRolesFor: [enc(S_A)]
		});
		expect(sorted(await svc.canReadChannels('did:syr:alice', [enc(CH_A.id)]))).toEqual([
			enc(CH_A.id)
		]);
	});

	it('isolates a failing server: its channels are denied, everything else survives', async () => {
		const { svc, warn } = makeService({ failRolesFor: [enc(S_A)] });
		const allowed = await svc.canReadChannels('did:syr:alice', [
			enc(CH_A.id), // server A — read explodes
			enc(CH_B.id), // server B — healthy
			enc(CH_DM.id) // DM — resolved before any server is touched
		]);
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

		const allowed = await svc.canReadChannels('did:syr:alice', [enc(CH_A.id), enc(CH_DM.id)]);
		expect(sorted(allowed)).toEqual([enc(CH_DM.id)]);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('returns an empty set for an empty request without touching a repository', async () => {
		const { svc } = makeService({ failRolesFor: [enc(S_A), enc(S_B)] });
		expect([...(await svc.canReadChannels('did:syr:alice', []))]).toEqual([]);
	});
});
