import type { RecordId } from 'surrealdb';
import { Permissions, hasPermission, stringToRecordId } from '@slyng/types';

/**
 * The permission cascade, folded in memory.
 *
 * Layers, lowest → highest priority:
 *   1. server role perms (role allow/deny, applied in ascending role position)
 *   2. server user override
 *   3. role category overrides (ascending role position)
 *   4. role channel overrides (ascending role position)
 *   5. user category override
 *   6. user channel override
 *
 * Every layer is `perms = (perms & ~deny) | allow`, so a higher layer overrides
 * a lower one per-bit. Layers 1–2 are server-scoped and therefore constant
 * across channels: they are folded once and `forChannel` replays only layers
 * 3–6. That is the whole point of this module — answering for N channels costs
 * one read of the server's roles + overrides instead of N.
 *
 * Deliberately free of NestJS, DI and repository imports. `RoleService` (role
 * module), `MemberAccessService` (auth module) and `ChannelService` all
 * evaluate this cascade, and one of them cannot reach `RoleService` directly:
 *
 *   RoleService → ChatGateway → MemberAccessService → RoleService
 *
 * `MemberAccessService` specifically is inside that loop, which is why it used
 * to carry a hand-rolled copy of the cascade. Note this is narrower than "the
 * auth module cannot import RoleService" — `auth/permission.guard.ts` imports
 * it perfectly happily, because the guard is not on the cycle. Only
 * `MemberAccessService` is. Keeping the cascade in a leaf module gives every
 * caller one copy of the rules without adding an edge to the module graph; if
 * you are tempted to collapse this back into `RoleService`, that cycle is what
 * you will reintroduce.
 */

/** The `server_role` columns the cascade reads. */
export interface PermissionFoldRole {
	id: RecordId;
	position?: number;
	is_default?: boolean;
	deleted?: boolean;
	/** Legacy single mask; read only when `permissions_allow` is absent. */
	permissions?: string;
	permissions_allow?: string;
	permissions_deny?: string;
}

/**
 * The `permission_override` columns the cascade reads. `scope_id` is the row's
 * `RecordId` link, never the serialised string the wire schema carries —
 * `stringToRecordId.encode` validates `z.instanceof(RecordId)` and throws on a
 * string, so this authorisation path must not advertise a branch it cannot
 * evaluate.
 */
export interface PermissionFoldOverride {
	scope_type: string;
	/** Absent/null for server-scoped overrides. */
	scope_id?: RecordId | null;
	target_type: string;
	target_id: string;
	allow?: string;
	deny?: string;
}

export interface PermissionFoldInput {
	/** DID of the member being evaluated. */
	userId: string;
	/** Every `server_role` row for the server — unfiltered, unsorted. */
	roles: PermissionFoldRole[];
	/** Encoded ids of the roles the member holds. `@everyone` need not be listed. */
	assignedRoleIds: ReadonlySet<string>;
	/**
	 * Loads every `permission_override` row for the server. Called at most once,
	 * and never when the role layer alone already granted ADMINISTRATOR — that
	 * short-circuit is part of the cascade, so skipping the read is not a
	 * behaviour change.
	 */
	loadOverrides: () => Promise<PermissionFoldOverride[]>;
}

export interface PermissionFold {
	/** Layers 1–2: the server-wide answer, with no channel in scope. */
	readonly serverPermissions: bigint;
	/**
	 * False when no category- or channel-scoped override can move the answer
	 * (owner, non-member, role-granted ADMINISTRATOR, or a server with no such
	 * overrides at all). Callers use it to skip resolving a channel's category.
	 */
	readonly hasChannelScopedOverrides: boolean;
	/** Layers 3–6 replayed on top of `serverPermissions` for one channel. */
	forChannel(channelId: string, categoryId: string | null): bigint;
}

/** `perms = (perms & ~deny) | allow` — the single rule every layer applies. */
function applyOverride(perms: bigint, o: PermissionFoldOverride): bigint {
	const allow = BigInt(o.allow ?? '0');
	const deny = BigInt(o.deny ?? '0');
	return (perms & ~deny) | allow;
}

/** A fold whose answer no override can change — owner, non-member, admin. */
export function constantPermissionFold(permissions: bigint): PermissionFold {
	return {
		serverPermissions: permissions,
		hasChannelScopedOverrides: false,
		forChannel: () => permissions
	};
}

export async function resolvePermissionFold(input: PermissionFoldInput): Promise<PermissionFold> {
	const { userId, assignedRoleIds } = input;

	const allRoles = input.roles
		.filter((r) => !r.deleted)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

	// Layer 1: server role perms. Lowest position first, so higher roles win.
	let basePermissions = 0n;
	for (const r of allRoles) {
		if (!r.is_default && !assignedRoleIds.has(stringToRecordId.encode(r.id))) continue;
		const allow = BigInt(r.permissions_allow ?? r.permissions ?? '0');
		const deny = BigInt(r.permissions_deny ?? '0');
		basePermissions = (basePermissions & ~deny) | allow;
	}

	// Early admin bypass — no override is read, let alone applied.
	if (hasPermission(basePermissions, Permissions.ADMINISTRATOR)) {
		return constantPermissionFold(basePermissions);
	}

	const overrides = await input.loadOverrides();

	const rolePositionById = new Map<string, number>();
	const defaultRoleIds = new Set<string>();
	for (const r of allRoles) {
		const id = stringToRecordId.encode(r.id);
		rolePositionById.set(id, r.position ?? 0);
		if (r.is_default) defaultRoleIds.add(id);
	}

	// Bucket the overrides by the scope they attach to, in array order, so a
	// per-channel lookup is a map hit instead of a scan of the whole set.
	const roleCategoryOverrides = new Map<string, PermissionFoldOverride[]>();
	const roleChannelOverrides = new Map<string, PermissionFoldOverride[]>();
	const userCategoryOverrides = new Map<string, PermissionFoldOverride>();
	const userChannelOverrides = new Map<string, PermissionFoldOverride>();
	let serverUserOverride: PermissionFoldOverride | undefined;

	const scopeKeyOf = (o: PermissionFoldOverride): string | null =>
		o.scope_id ? stringToRecordId.encode(o.scope_id) : null;

	const bucketRole = (
		bucket: Map<string, PermissionFoldOverride[]>,
		key: string,
		o: PermissionFoldOverride
	) => {
		const list = bucket.get(key);
		if (list) list.push(o);
		else bucket.set(key, [o]);
	};

	// `find` semantics: the first matching row for a scope wins.
	const bucketUser = (
		bucket: Map<string, PermissionFoldOverride>,
		key: string,
		o: PermissionFoldOverride
	) => {
		if (!bucket.has(key)) bucket.set(key, o);
	};

	for (const o of overrides) {
		if (o.target_type === 'role') {
			// A role override only counts when the member holds that role, or it
			// targets @everyone.
			if (!assignedRoleIds.has(o.target_id) && !defaultRoleIds.has(o.target_id)) continue;
			const key = scopeKeyOf(o);
			// Server-scoped role overrides are not a layer — roles carry their
			// server-wide grant in layer 1.
			if (key === null) continue;
			if (o.scope_type === 'category') bucketRole(roleCategoryOverrides, key, o);
			else if (o.scope_type === 'channel') bucketRole(roleChannelOverrides, key, o);
			continue;
		}
		if (o.target_type !== 'user' || o.target_id !== userId) continue;
		const key = scopeKeyOf(o);
		if (o.scope_type === 'server') {
			if (key === null && serverUserOverride === undefined) serverUserOverride = o;
			continue;
		}
		if (key === null) continue;
		if (o.scope_type === 'category') bucketUser(userCategoryOverrides, key, o);
		else if (o.scope_type === 'channel') bucketUser(userChannelOverrides, key, o);
	}

	// Ascending role position, matching the layer-1 ordering. `sort` is stable,
	// so equal positions keep their row order.
	const byRolePosition = (a: PermissionFoldOverride, b: PermissionFoldOverride) =>
		(rolePositionById.get(a.target_id) ?? 0) - (rolePositionById.get(b.target_id) ?? 0);
	for (const list of roleCategoryOverrides.values()) list.sort(byRolePosition);
	for (const list of roleChannelOverrides.values()) list.sort(byRolePosition);

	// Layer 2: server user override.
	if (serverUserOverride) basePermissions = applyOverride(basePermissions, serverUserOverride);

	const serverPermissions = basePermissions;
	const hasChannelScopedOverrides =
		roleCategoryOverrides.size > 0 ||
		roleChannelOverrides.size > 0 ||
		userCategoryOverrides.size > 0 ||
		userChannelOverrides.size > 0;

	return {
		serverPermissions,
		hasChannelScopedOverrides,
		forChannel(channelId: string, categoryId: string | null): bigint {
			let perms = serverPermissions;

			// Layer 3: role category overrides
			if (categoryId) {
				for (const o of roleCategoryOverrides.get(categoryId) ?? []) {
					perms = applyOverride(perms, o);
				}
			}

			// Layer 4: role channel overrides
			for (const o of roleChannelOverrides.get(channelId) ?? []) {
				perms = applyOverride(perms, o);
			}

			// Layer 5: user category override
			if (categoryId) {
				const catUserOverride = userCategoryOverrides.get(categoryId);
				if (catUserOverride) perms = applyOverride(perms, catUserOverride);
			}

			// Layer 6: user channel override (highest priority)
			const chUserOverride = userChannelOverrides.get(channelId);
			if (chUserOverride) perms = applyOverride(perms, chUserOverride);

			return perms;
		}
	};
}
