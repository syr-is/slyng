import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import { Permissions, hasPermission, stringToRecordId } from '@slyng/types';
import {
	constantPermissionFold,
	resolvePermissionFold,
	type PermissionFoldOverride,
	type PermissionFoldRole
} from './permission-fold';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORACLE.
 *
 * This is a verbatim copy of the six-layer cascade as it was written inline in
 * `RoleService.computePermissions` before it was extracted into
 * `permission-fold.ts` — the body from just after the member lookup through the
 * final `return perms`, with the two DB reads replaced by the arrays they
 * returned. It is kept structurally identical on purpose: the per-scope
 * `filter`/`find`/`sort` walks, the `allRoles.find(...)` position lookup and the
 * `applicable` pre-filter are all how the original did it, not how the fold does
 * it. Its only job is to disagree with the fold if the fold ever drifts.
 *
 * DO NOT refactor this to share helpers with the implementation. An oracle that
 * imports the thing it is checking proves nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function originalCascade(
	userId: string,
	assignedSet: ReadonlySet<string>,
	roleRows: PermissionFoldRole[],
	allOverrides: PermissionFoldOverride[],
	channelId: string | undefined,
	categoryId: string | null
): bigint {
	const allRoles = roleRows
		.filter((r) => !r.deleted)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

	const applicable = allRoles.filter(
		(r) => r.is_default || assignedSet.has(stringToRecordId.encode(r.id))
	);

	// Layer 1: server role perms
	let perms = 0n;
	for (const r of applicable) {
		const allow = BigInt(r.permissions_allow ?? r.permissions ?? '0');
		const deny = BigInt(r.permissions_deny ?? '0');
		perms = (perms & ~deny) | allow;
	}

	// Early admin bypass — no need to walk overrides
	if (hasPermission(perms, Permissions.ADMINISTRATOR)) return perms;

	const applyOverride = (o: PermissionFoldOverride) => {
		const allow = BigInt(o.allow ?? '0');
		const deny = BigInt(o.deny ?? '0');
		perms = (perms & ~deny) | allow;
	};

	const roleOverridesForScope = (scopeType: string, scopeId: string | null) =>
		allOverrides
			.filter((o) => {
				if (o.target_type !== 'role') return false;
				if (o.scope_type !== scopeType) return false;
				const oScopeId = o.scope_id ? stringToRecordId.encode(o.scope_id) : null;
				if (oScopeId !== scopeId) return false;
				return (
					assignedSet.has(o.target_id) ||
					allRoles.some((r) => r.is_default && stringToRecordId.encode(r.id) === o.target_id)
				);
			})
			.sort((a, b) => {
				const posA = allRoles.find((r) => stringToRecordId.encode(r.id) === a.target_id);
				const posB = allRoles.find((r) => stringToRecordId.encode(r.id) === b.target_id);
				return (posA?.position ?? 0) - (posB?.position ?? 0);
			});

	const userOverrideForScope = (scopeType: string, scopeId: string | null) =>
		allOverrides.find((o) => {
			if (o.target_type !== 'user' || o.target_id !== userId) return false;
			if (o.scope_type !== scopeType) return false;
			const oScopeId = o.scope_id ? stringToRecordId.encode(o.scope_id) : null;
			return oScopeId === scopeId;
		});

	// Layer 2: server user override
	const serverUserOverride = userOverrideForScope('server', null);
	if (serverUserOverride) applyOverride(serverUserOverride);

	if (!channelId) return perms;

	// Layer 3: role category overrides
	if (categoryId) {
		for (const o of roleOverridesForScope('category', categoryId)) applyOverride(o);
	}

	// Layer 4: role channel overrides
	for (const o of roleOverridesForScope('channel', channelId)) applyOverride(o);

	// Layer 5: user category override
	if (categoryId) {
		const catUserOverride = userOverrideForScope('category', categoryId);
		if (catUserOverride) applyOverride(catUserOverride);
	}

	// Layer 6: user channel override (highest priority)
	const chUserOverride = userOverrideForScope('channel', channelId);
	if (chUserOverride) applyOverride(chUserOverride);

	return perms;
}

// ── deterministic RNG, so a failure is always reproducible ──────────────────
function makeRng(initial: number) {
	let seed = initial >>> 0;
	return () => {
		seed ^= seed << 13;
		seed >>>= 0;
		seed ^= seed >> 17;
		seed ^= seed << 5;
		seed >>>= 0;
		return seed / 0x100000000;
	};
}

const FLAGS = Object.values(Permissions);
const USERS = ['did:syr:alice', 'did:syr:bob', 'did:syr:carol'];

interface World {
	userId: string;
	roles: PermissionFoldRole[];
	assigned: Set<string>;
	overrides: PermissionFoldOverride[];
	channels: Array<{ id: RecordId; category_id: RecordId | null }>;
}

function makeWorld(rnd: () => number): World {
	const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
	const int = (n: number) => Math.floor(rnd() * n);
	const mask = (): string => {
		if (rnd() < 0.15) return '0';
		let m = 0n;
		const n = 1 + int(3);
		for (let i = 0; i < n; i++) m |= pick(FLAGS);
		if (rnd() < 0.08) m |= Permissions.ADMINISTRATOR;
		return m.toString();
	};

	const roles: PermissionFoldRole[] = [];
	const nRoles = 1 + int(5);
	for (let i = 0; i < nRoles; i++) {
		const row: PermissionFoldRole = {
			id: new RecordId('server_role', `r${i}`),
			// duplicate positions on purpose — exercises sort stability
			position: int(3),
			is_default: i === 0 ? true : rnd() < 0.15,
			deleted: rnd() < 0.2,
			permissions_deny: rnd() < 0.8 ? mask() : undefined
		};
		// some rows predate the allow/deny split and carry only `permissions`
		if (rnd() < 0.25) row.permissions = mask();
		else row.permissions_allow = mask();
		roles.push(row);
	}

	const assigned = new Set<string>();
	for (const r of roles) if (rnd() < 0.5) assigned.add(stringToRecordId.encode(r.id));

	const cats: RecordId[] = [];
	for (let i = 0; i < 1 + int(3); i++) cats.push(new RecordId('channel_category', `c${i}`));

	const channels: World['channels'] = [];
	for (let i = 0; i < 1 + int(6); i++) {
		channels.push({
			id: new RecordId('channel', `ch${i}`),
			category_id: rnd() < 0.3 ? null : pick(cats)
		});
	}

	const scopes: Array<() => { scope_type: string; scope_id: RecordId | null }> = [
		() => ({ scope_type: 'server', scope_id: null }),
		() => ({ scope_type: 'category', scope_id: pick(cats) }),
		() => ({ scope_type: 'channel', scope_id: pick(channels).id }),
		// malformed rows: scope ids that don't match their scope type
		() => ({ scope_type: 'category', scope_id: null }),
		() => ({ scope_type: 'server', scope_id: pick(cats) }),
		() => ({ scope_type: 'channel', scope_id: null })
	];

	const overrides: PermissionFoldOverride[] = [];
	for (let i = 0; i < int(12); i++) {
		const s = pick(scopes)();
		const isRole = rnd() < 0.6;
		overrides.push({
			// unknown scope/target kinds must be ignored identically by both
			scope_type: rnd() < 0.05 ? 'guild' : s.scope_type,
			scope_id: s.scope_id,
			target_type: rnd() < 0.05 ? 'webhook' : isRole ? 'role' : 'user',
			// a target matching no live role — the position lookup falls back to 0
			target_id: isRole
				? rnd() < 0.1
					? 'server_role:ghost'
					: stringToRecordId.encode(pick(roles).id)
				: pick(USERS),
			// absent masks exercise the `?? '0'` fallbacks
			allow: rnd() < 0.1 ? undefined : mask(),
			deny: rnd() < 0.1 ? undefined : mask()
		});
	}

	return { userId: pick(USERS), roles, assigned, overrides, channels };
}

const role = (
	id: string,
	position: number,
	extra: Partial<PermissionFoldRole> = {}
): PermissionFoldRole => ({
	id: new RecordId('server_role', id),
	position,
	permissions_allow: '0',
	permissions_deny: '0',
	...extra
});

const CHANNEL = new RecordId('channel', 'general');
const CATEGORY = new RecordId('channel_category', 'text');
const CHANNEL_ID = stringToRecordId.encode(CHANNEL);
const CATEGORY_ID = stringToRecordId.encode(CATEGORY);

describe('resolvePermissionFold — differential against the original cascade', () => {
	it('agrees on every channel of 3000 randomised servers', async () => {
		const rnd = makeRng(0x2f6e2b1);
		let comparisons = 0;

		for (let w = 0; w < 3000; w++) {
			const { userId, roles, assigned, overrides, channels } = makeWorld(rnd);

			const fold = await resolvePermissionFold({
				userId,
				roles,
				assignedRoleIds: assigned,
				loadOverrides: async () => overrides
			});

			// server-wide answer (layers 1-2, no channel in scope)
			expect(fold.serverPermissions).toBe(
				originalCascade(userId, assigned, roles, overrides, undefined, null)
			);
			comparisons++;

			for (const ch of channels) {
				const chId = stringToRecordId.encode(ch.id);
				const catId = ch.category_id ? stringToRecordId.encode(ch.category_id) : null;
				const expected = originalCascade(userId, assigned, roles, overrides, chId, catId);

				expect(fold.forChannel(chId, catId)).toBe(expected);
				comparisons++;

				// the query-skipping gate must never hide a difference: when it
				// says no channel-scoped override applies, the per-channel answer
				// has to equal the server-wide one for every channel.
				if (!fold.hasChannelScopedOverrides) {
					expect(fold.forChannel(chId, catId)).toBe(fold.serverPermissions);
				}
			}
		}

		expect(comparisons).toBeGreaterThan(10_000);
	});
});

describe('resolvePermissionFold — cascade rules', () => {
	const base = {
		userId: 'did:syr:alice',
		roles: [
			role('everyone', 0, {
				is_default: true,
				permissions_allow: Permissions.READ_MESSAGES.toString()
			}),
			role('mod', 5)
		],
		assignedRoleIds: new Set([stringToRecordId.encode(new RecordId('server_role', 'mod'))])
	};

	it('applies @everyone without it being assigned to the member', async () => {
		const fold = await resolvePermissionFold({ ...base, loadOverrides: async () => [] });
		expect(hasPermission(fold.serverPermissions, Permissions.READ_MESSAGES)).toBe(true);
	});

	it('ignores soft-deleted roles', async () => {
		const fold = await resolvePermissionFold({
			...base,
			roles: [
				...base.roles,
				role('ghost', 9, { deleted: true, permissions_deny: Permissions.READ_MESSAGES.toString() })
			],
			loadOverrides: async () => []
		});
		expect(hasPermission(fold.serverPermissions, Permissions.READ_MESSAGES)).toBe(true);
	});

	it('never reads overrides when the role layer already granted ADMINISTRATOR', async () => {
		let loaded = 0;
		const fold = await resolvePermissionFold({
			...base,
			roles: [role('admin', 1, { permissions_allow: Permissions.ADMINISTRATOR.toString() })],
			assignedRoleIds: new Set([stringToRecordId.encode(new RecordId('server_role', 'admin'))]),
			loadOverrides: async () => {
				loaded++;
				return [];
			}
		});
		expect(loaded).toBe(0);
		expect(fold.serverPermissions).toBe(Permissions.ADMINISTRATOR);
		expect(fold.hasChannelScopedOverrides).toBe(false);
		expect(fold.forChannel(CHANNEL_ID, CATEGORY_ID)).toBe(Permissions.ADMINISTRATOR);
	});

	it('orders the six layers lowest-priority first', async () => {
		// Every layer denies READ_MESSAGES and the next one grants it back, so
		// only the highest-priority layer that fires decides the answer.
		const ov = (
			scope_type: string,
			scope_id: RecordId | null,
			target_type: string,
			target_id: string,
			allow: bigint,
			deny: bigint
		): PermissionFoldOverride => ({
			scope_type,
			scope_id,
			target_type,
			target_id,
			allow: allow.toString(),
			deny: deny.toString()
		});
		const modId = stringToRecordId.encode(new RecordId('server_role', 'mod'));
		const R = Permissions.READ_MESSAGES;

		const layers: PermissionFoldOverride[] = [
			ov('server', null, 'user', base.userId, R, 0n), // 2 grants
			ov('category', CATEGORY, 'role', modId, 0n, R), // 3 denies
			ov('channel', CHANNEL, 'role', modId, R, 0n), // 4 grants
			ov('category', CATEGORY, 'user', base.userId, 0n, R), // 5 denies
			ov('channel', CHANNEL, 'user', base.userId, R, 0n) // 6 grants
		];

		// all six present → layer 6 wins → granted
		const all = await resolvePermissionFold({
			...base,
			roles: [role('everyone', 0, { is_default: true }), role('mod', 5)],
			loadOverrides: async () => layers
		});
		expect(all.hasChannelScopedOverrides).toBe(true);
		expect(hasPermission(all.forChannel(CHANNEL_ID, CATEGORY_ID), R)).toBe(true);

		// drop layer 6 → layer 5 (user category deny) wins → denied
		const upTo5 = await resolvePermissionFold({
			...base,
			roles: [role('everyone', 0, { is_default: true }), role('mod', 5)],
			loadOverrides: async () => layers.slice(0, 4)
		});
		expect(hasPermission(upTo5.forChannel(CHANNEL_ID, CATEGORY_ID), R)).toBe(false);

		// drop layers 5-6 → layer 4 (role channel grant) wins → granted
		const upTo4 = await resolvePermissionFold({
			...base,
			roles: [role('everyone', 0, { is_default: true }), role('mod', 5)],
			loadOverrides: async () => layers.slice(0, 3)
		});
		expect(hasPermission(upTo4.forChannel(CHANNEL_ID, CATEGORY_ID), R)).toBe(true);

		// drop layers 4-6 → layer 3 (role category deny) wins → denied
		const upTo3 = await resolvePermissionFold({
			...base,
			roles: [role('everyone', 0, { is_default: true }), role('mod', 5)],
			loadOverrides: async () => layers.slice(0, 2)
		});
		expect(hasPermission(upTo3.forChannel(CHANNEL_ID, CATEGORY_ID), R)).toBe(false);

		// only layer 2 → server-wide grant survives into the channel answer
		const upTo2 = await resolvePermissionFold({
			...base,
			roles: [role('everyone', 0, { is_default: true }), role('mod', 5)],
			loadOverrides: async () => layers.slice(0, 1)
		});
		expect(hasPermission(upTo2.serverPermissions, R)).toBe(true);
		expect(hasPermission(upTo2.forChannel(CHANNEL_ID, CATEGORY_ID), R)).toBe(true);
		expect(upTo2.hasChannelScopedOverrides).toBe(false);
	});

	it('applies role overrides in ascending role position', async () => {
		const lowId = stringToRecordId.encode(new RecordId('server_role', 'low'));
		const highId = stringToRecordId.encode(new RecordId('server_role', 'high'));
		const R = Permissions.READ_MESSAGES;

		// listed high-position-first so only a correct sort can let `low` lose
		const overrides: PermissionFoldOverride[] = [
			{
				scope_type: 'channel',
				scope_id: CHANNEL,
				target_type: 'role',
				target_id: highId,
				allow: R.toString(),
				deny: '0'
			},
			{
				scope_type: 'channel',
				scope_id: CHANNEL,
				target_type: 'role',
				target_id: lowId,
				allow: '0',
				deny: R.toString()
			}
		];

		const fold = await resolvePermissionFold({
			userId: 'did:syr:alice',
			roles: [role('low', 1), role('high', 9)],
			assignedRoleIds: new Set([lowId, highId]),
			loadOverrides: async () => overrides
		});
		// high position is applied last, so its grant wins
		expect(hasPermission(fold.forChannel(CHANNEL_ID, null), R)).toBe(true);
	});

	it('ignores overrides for roles the member does not hold', async () => {
		const otherId = stringToRecordId.encode(new RecordId('server_role', 'other'));
		const fold = await resolvePermissionFold({
			...base,
			roles: [...base.roles, role('other', 7)],
			loadOverrides: async () => [
				{
					scope_type: 'channel',
					scope_id: CHANNEL,
					target_type: 'role',
					target_id: otherId,
					allow: '0',
					deny: Permissions.READ_MESSAGES.toString()
				}
			]
		});
		expect(hasPermission(fold.forChannel(CHANNEL_ID, null), Permissions.READ_MESSAGES)).toBe(true);
	});
});

describe('constantPermissionFold', () => {
	it('answers the same for every channel and never claims channel scope', () => {
		const fold = constantPermissionFold(Permissions.ADMINISTRATOR);
		expect(fold.serverPermissions).toBe(Permissions.ADMINISTRATOR);
		expect(fold.hasChannelScopedOverrides).toBe(false);
		expect(fold.forChannel(CHANNEL_ID, CATEGORY_ID)).toBe(Permissions.ADMINISTRATOR);
		expect(fold.forChannel('channel:anything', null)).toBe(Permissions.ADMINISTRATOR);
		expect(constantPermissionFold(0n).forChannel(CHANNEL_ID, CATEGORY_ID)).toBe(0n);
	});
});
