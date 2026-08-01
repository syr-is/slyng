import { Injectable, Logger } from '@nestjs/common';
import { RecordId } from 'surrealdb';
import { Permissions, hasPermission, stringToRecordId } from '@slyng/types';
import { PermissionOverrideRepository } from '../permission-override/override.repository';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerBanRepository,
	ServerRoleRepository
} from '../server/server.repository';
import {
	ChannelRepository,
	ChannelCategoryRepository,
	ChannelParticipantRepository
} from '../channel/channel.repository';
import { groupChannelTopicsByServer, isChannelTopic } from '../common/channel-topics';
import {
	constantPermissionFold,
	resolvePermissionFold,
	type PermissionFold
} from '../common/permission-fold';
import type { AuthedRequest } from './authed-request';

/**
 * Shared server-access authoriser used by:
 *  - `ServerAccessGuard` (HTTP route protection)
 *  - `ChatGateway.handleSubscribe` (WS topic protection)
 *
 * Kept separate from `MemberService` / `ServerService` to avoid circular DI
 * between the gateway module and the server/member modules.
 */
@Injectable()
export class MemberAccessService {
	private readonly logger = new Logger(MemberAccessService.name);

	constructor(
		private readonly servers: ServerRepository,
		private readonly members: ServerMemberRepository,
		private readonly bans: ServerBanRepository,
		private readonly roles: ServerRoleRepository,
		private readonly channels: ChannelRepository,
		private readonly categories: ChannelCategoryRepository,
		private readonly permOverrides: PermissionOverrideRepository,
		private readonly participants: ChannelParticipantRepository
	) {}

	/**
	 * Given a topic id (either a server id or a channel id), resolve which
	 * server it belongs to. Returns null for topics that aren't server-scoped
	 * (e.g. DM channels if/when we add them) so callers can treat those as
	 * "no membership check required".
	 */
	async resolveServerId(topicId: string): Promise<string | null> {
		if (!topicId) return null;
		if (topicId.startsWith('server:')) {
			const exists = await this.servers.findById(topicId);
			return exists ? topicId : null;
		}
		if (isChannelTopic(topicId)) {
			const channel = await this.channels.findById(topicId);
			if (!channel) return null;
			const sid = channel.server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		// Unknown prefix — not a server-scoped topic
		return null;
	}

	/**
	 * Resolve which server a request targets via its route params. Returns
	 * null when the route isn't server-scoped (e.g. /servers/@me, /users/...).
	 * Shared by `ServerAccessGuard` + `PermissionGuard`.
	 */
	async resolveRouteServerId(req: AuthedRequest): Promise<string | null> {
		const params = req?.params ?? {};
		// Express types route params as `string | string[]` — a repeated param
		// (`?serverId=a&serverId=b` style path matching) yields an array, which
		// must not be handed to the repositories as an id. Take the first value.
		const param = (key: string): string | null => {
			const v = params[key] as string | string[] | undefined;
			if (Array.isArray(v)) return v[0] ?? null;
			return v ?? null;
		};
		const serverIdParam = param('serverId');
		if (serverIdParam) return serverIdParam;
		const channelIdParam = param('channelId');
		if (channelIdParam) {
			const channel = await this.channels.findById(channelIdParam);
			if (!channel) return null;
			const sid = channel.server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		const roleIdParam = param('roleId');
		if (roleIdParam) {
			const role = await this.roles.findById(roleIdParam);
			if (!role) return null;
			const sid = role.server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		const categoryIdParam = param('categoryId');
		if (categoryIdParam) {
			const cat = await this.categories.findById(categoryIdParam);
			if (!cat) return null;
			const sid = cat.server_id as RecordId | string | undefined;
			return sid ? stringToRecordId.encode(sid as RecordId) : null;
		}
		return null;
	}

	async isMember(userId: string, serverId: string): Promise<boolean> {
		const ref = stringToRecordId.decode(serverId);
		const row = await this.members.findOne({ server_id: ref, user_id: userId });
		return !!row;
	}

	async isBanned(userId: string, serverId: string): Promise<boolean> {
		const ref = stringToRecordId.decode(serverId);
		// Only ACTIVE bans count — unbanned rows are kept for audit history.
		const row = await this.bans.findOne({ server_id: ref, user_id: userId, active: true });
		return !!row;
	}

	/** True iff user may read/listen to the server (member AND not banned). */
	async isAllowed(userId: string, serverId: string): Promise<boolean> {
		if (await this.isBanned(userId, serverId)) return false;
		return this.isMember(userId, serverId);
	}

	/**
	 * Load the permission cascade for one member of one server.
	 *
	 * Runs the same cascade `RoleService.computePermissions` runs, through the
	 * shared fold in `common/permission-fold`. The fold is imported rather than
	 * `RoleService` itself because this service sits on a dependency cycle —
	 * `RoleService → ChatGateway → MemberAccessService` — so injecting
	 * `RoleService` here would close it. The fold is a leaf module (no NestJS,
	 * no DI, no repositories), so only these four reads are duplicated, never
	 * the rules.
	 *
	 * Returns null when the user may not read the server at all: banned, or not
	 * a member. The owner gets a constant ADMINISTRATOR fold.
	 */
	private async foldForServer(userId: string, serverId: string): Promise<PermissionFold | null> {
		if (await this.isBanned(userId, serverId)) return null;

		const ref = stringToRecordId.decode(serverId);
		// Doubles as `isMember` — the fold needs this row anyway, so it is read
		// once instead of once for the membership gate and once for the roles.
		const member = await this.members.findOne({ server_id: ref, user_id: userId });
		if (!member) return null;

		const server = await this.servers.findById(serverId);
		if (server && server.owner_id === userId) {
			return constantPermissionFold(Permissions.ADMINISTRATOR);
		}

		const roleIds = member.role_ids ?? [];
		return resolvePermissionFold({
			userId,
			roles: await this.roles.findMany({ server_id: ref }),
			assignedRoleIds: new Set(roleIds.map((rid) => stringToRecordId.encode(rid))),
			loadOverrides: () => this.permOverrides.findMany({ server_id: ref })
		});
	}

	/**
	 * The subset of `channelIds` the user may read: server membership, not
	 * banned, and READ_MESSAGES surviving the override cascade.
	 *
	 * Batched, and only batched — there is deliberately no single-channel
	 * sibling. `ChatGateway` receives a client's entire topic list in one frame
	 * (the server plus every channel, re-sent on every reconnect), so answering
	 * one channel at a time re-ran the ban, membership, owner, role and
	 * override reads once per channel, about ten sequential queries each. This
	 * reads every channel row in one query, groups them by server, and folds
	 * each server's permissions once. A second single-channel entry point would
	 * be a second answer to the same question, which is exactly what this branch
	 * exists to remove; call this with a one-element array instead.
	 *
	 * A channel with no row is excluded; a DM channel with no server scope is
	 * included. Ids come back in the exact string the caller passed, which is
	 * also the channel-scope key the cascade matches overrides on.
	 */
	async canReadChannels(userId: string, channelIds: string[]): Promise<Set<string>> {
		const allowed = new Set<string>();
		if (!channelIds.length) return allowed;

		const rows = await this.channels.findByIds([...new Set(channelIds)]);
		const { unscoped, byServer, unresolved } = groupChannelTopicsByServer(channelIds, rows);

		// Unscoped channels are DMs and group DMs — no server, so no fold can
		// answer them. Membership is the whole authorisation, and it is a real
		// check: admitting these unconditionally let any authenticated socket
		// subscribe to any DM id it could name and receive that conversation.
		//
		// One read for the caller's own participations rather than one per
		// channel — the frame carries a client's whole DM list on every
		// reconnect. A self-DM needs no special case: the user is a participant
		// of it like any other.
		if (unscoped.length) {
			try {
				const mine = await this.participants.findMany({ user_id: userId });
				const participating = new Set(
					mine.map((p) => stringToRecordId.encode(p.channel_id as RecordId))
				);
				for (const id of unscoped) {
					if (participating.has(id)) allowed.add(id);
				}
			} catch (err) {
				// Fail closed, and only for the DMs — the server-scoped folds
				// below are unaffected by this read.
				this.logger.warn(
					`Participation lookup failed; denying ${unscoped.length} DM topic(s): ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}
		}
		if (unresolved.length) {
			// Denied by omission, but worth a trace: a client asking about
			// channels that no longer exist means its channel list has drifted.
			this.logger.debug(
				`Ignoring ${unresolved.length} unknown channel(s): ${unresolved.join(', ')}`
			);
		}

		for (const [serverId, channels] of byServer) {
			// Per-server guard: one server's read failing must deny that server's
			// channels, not the whole frame. Without it a single fault would
			// reject out of here and cost the caller every other server's topics
			// — including the DM ids already added above.
			let fold: PermissionFold | null;
			try {
				fold = await this.foldForServer(userId, serverId);
			} catch (err) {
				// Never `(err as Error).message` — a thrown `null` would raise
				// inside the catch and take out the whole batch it exists to save.
				this.logger.warn(
					`Permission fold failed for ${serverId}; denying its channels: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
				continue;
			}
			if (!fold) continue;

			for (const { id, categoryId } of channels) {
				if (hasPermission(fold.forChannel(id, categoryId), Permissions.READ_MESSAGES)) {
					allowed.add(id);
				}
			}
		}
		return allowed;
	}
}
