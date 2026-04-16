import {
	Injectable,
	Logger,
	Optional,
	ForbiddenException,
	NotFoundException,
	BadRequestException
} from '@nestjs/common';
import { RecordId } from 'surrealdb';
import {
	WsOp,
	stringToRecordId,
	type AllowDms,
	type AllowFriendRequests,
	type CanDmResult
} from '@syren/types';
import {
	FriendshipRepository,
	UserBlockRepository,
	UserIgnoreRepository
} from './relation.repository';
import { UserRepository } from '../auth/user.repository';
import { ServerMemberRepository } from '../server/server.repository';
import { ChatGateway } from '../gateway/chat.gateway';

export interface RelationsSnapshot {
	friends: string[];
	incoming: Array<{ from: string; created_at: unknown }>;
	outgoing: Array<{ to: string; created_at: unknown }>;
	blocked: string[];
	ignored: string[];
	allow_dms: AllowDms;
	allow_friend_requests: AllowFriendRequests;
	/** did → syr_instance_url for every DID mentioned above, so the client
	 *  can resolve federated profiles without a second roundtrip. */
	instances: Record<string, string>;
}

@Injectable()
export class RelationService {
	private readonly logger = new Logger(RelationService.name);

	constructor(
		private readonly friendships: FriendshipRepository,
		private readonly blocks: UserBlockRepository,
		private readonly ignores: UserIgnoreRepository,
		private readonly users: UserRepository,
		private readonly members: ServerMemberRepository,
		@Optional() private readonly gateway?: ChatGateway
	) {}

	// ── Pair helpers ──
	private orderPair(a: string, b: string): [string, string] {
		return a < b ? [a, b] : [b, a];
	}

	// ── Queries ──
	async areFriends(a: string, b: string): Promise<boolean> {
		const [lo, hi] = this.orderPair(a, b);
		const row = await this.friendships.findOne({
			user_a_id: lo,
			user_b_id: hi,
			status: 'accepted'
		});
		return !!row;
	}

	async findPendingBetween(a: string, b: string) {
		const [lo, hi] = this.orderPair(a, b);
		return this.friendships.findOne({ user_a_id: lo, user_b_id: hi, status: 'pending' });
	}

	async isBlocked(viewer: string, other: string): Promise<boolean> {
		const row = await this.blocks.findOne({ blocker_id: viewer, blocked_id: other });
		return !!row;
	}

	async isBlockedByEither(a: string, b: string): Promise<boolean> {
		const [forward, reverse] = await Promise.all([
			this.isBlocked(a, b),
			this.isBlocked(b, a)
		]);
		return forward || reverse;
	}

	async isIgnored(viewer: string, other: string): Promise<boolean> {
		const row = await this.ignores.findOne({ user_id: viewer, ignored_id: other });
		return !!row;
	}

	/** At least one shared server row — used for the 'mutual' friend-request policy. */
	async sharedServer(a: string, b: string): Promise<boolean> {
		const aMembers = await this.members.findMany({ user_id: a });
		if (!aMembers.length) return false;
		const aServerIds = new Set(
			aMembers.map((m) => stringToRecordId.encode((m as any).server_id as RecordId))
		);
		const bMembers = await this.members.findMany({ user_id: b });
		return bMembers.some((m) =>
			aServerIds.has(stringToRecordId.encode((m as any).server_id as RecordId))
		);
	}

	async canDM(from: string, to: string): Promise<CanDmResult> {
		if (from === to) return { allowed: true }; // DM to self never triggers — guarded upstream
		if (await this.isBlockedByEither(from, to)) {
			return { allowed: false, reason: 'blocked' };
		}
		const target = (await this.users.findOne({ did: to })) as any;
		const policy = (target?.allow_dms as AllowDms | undefined) ?? 'open';
		if (policy === 'closed') return { allowed: false, reason: 'dm_closed' };
		if (policy === 'friends_only') {
			const friends = await this.areFriends(from, to);
			if (!friends) return { allowed: false, reason: 'dm_friends_only' };
		}
		return { allowed: true };
	}

	async relationsFor(userId: string): Promise<RelationsSnapshot> {
		// Friendship rows where the caller is a participant.
		const asA = await this.friendships.findMany({ user_a_id: userId });
		const asB = await this.friendships.findMany({ user_b_id: userId });
		const rows = [...asA, ...asB];

		const friends: string[] = [];
		const incoming: Array<{ from: string; created_at: unknown }> = [];
		const outgoing: Array<{ to: string; created_at: unknown }> = [];
		for (const r of rows) {
			const row = r as any;
			const other = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
			if (row.status === 'accepted') {
				friends.push(other);
			} else if (row.status === 'pending') {
				if (row.requested_by === userId) {
					outgoing.push({ to: other, created_at: row.created_at });
				} else {
					incoming.push({ from: other, created_at: row.created_at });
				}
			}
		}

		const [blockedRows, ignoredRows, me] = await Promise.all([
			this.blocks.findMany({ blocker_id: userId }),
			this.ignores.findMany({ user_id: userId }),
			this.users.findOne({ did: userId }) as Promise<any>
		]);

		const blocked = blockedRows.map((b) => (b as any).blocked_id as string);
		const ignored = ignoredRows.map((i) => (i as any).ignored_id as string);
		const allDids = new Set<string>([
			...friends,
			...incoming.map((r) => r.from),
			...outgoing.map((r) => r.to),
			...blocked,
			...ignored
		]);
		const instances = await this.lookupInstances([...allDids]);

		return {
			friends,
			incoming,
			outgoing,
			blocked,
			ignored,
			allow_dms: (me?.allow_dms as AllowDms | undefined) ?? 'open',
			allow_friend_requests:
				(me?.allow_friend_requests as AllowFriendRequests | undefined) ?? 'open',
			instances
		};
	}

	/**
	 * Resolve `did → syr_instance_url` for a batch of DIDs. Returns only the
	 * DIDs we have a local user row for — unknown DIDs are silently omitted
	 * (clients fall back to truncated DID rendering).
	 */
	private async lookupInstances(dids: string[]): Promise<Record<string, string>> {
		if (!dids.length) return {};
		const all = await this.users.findMany();
		const wanted = new Set(dids);
		const out: Record<string, string> = {};
		for (const u of all) {
			const did = (u as any).did as string | undefined;
			const instance = (u as any).syr_instance_url as string | undefined;
			if (did && instance && wanted.has(did)) out[did] = instance;
		}
		return out;
	}

	private async instanceFor(did: string): Promise<string | null> {
		const user = (await this.users.findOne({ did })) as any;
		return (user?.syr_instance_url as string | undefined) ?? null;
	}

	// ── Friend-request lifecycle ──
	async sendFriendRequest(from: string, to: string, syrInstanceUrl?: string) {
		if (from === to) throw new BadRequestException('Cannot friend yourself');
		if (await this.isBlockedByEither(from, to)) {
			throw new ForbiddenException('Cannot send request');
		}
		if (await this.areFriends(from, to)) {
			throw new BadRequestException('Already friends');
		}
		if (await this.findPendingBetween(from, to)) {
			throw new BadRequestException('Request already pending');
		}
		let target = (await this.users.findOne({ did: to })) as any;
		if (!target && syrInstanceUrl) {
			const now = new Date();
			target = await this.users.create({
				did: to,
				syr_instance_url: syrInstanceUrl,
				created_at: now,
				updated_at: now
			} as any);
		}
		if (!target) throw new NotFoundException('User not found');
		const policy = (target.allow_friend_requests as AllowFriendRequests | undefined) ?? 'open';
		if (policy === 'closed') {
			throw new ForbiddenException('This user is not accepting friend requests');
		}
		if (policy === 'mutual' && !(await this.sharedServer(from, to))) {
			throw new ForbiddenException('This user only accepts requests from members of shared servers');
		}

		const [lo, hi] = this.orderPair(from, to);
		const now = new Date();
		const row = await this.friendships.create({
			user_a_id: lo,
			user_b_id: hi,
			status: 'pending',
			requested_by: from,
			created_at: now,
			updated_at: now
		});

		const senderInstance = await this.instanceFor(from);
		const targetInstance = (target.syr_instance_url as string | undefined) ?? null;

		// Notify recipient with a dedicated opcode so their UI badges the request.
		this.gateway?.emitToUser(to, {
			op: WsOp.FRIEND_REQUEST_RECEIVE,
			d: { from, created_at: now, instance_url: senderInstance }
		});
		// Echo to sender (other tabs) so outgoing list updates. Carries
		// created_at + target instance so the receiving store can populate
		// the outgoing map without a snapshot refetch.
		this.gateway?.emitToUser(from, {
			op: WsOp.FRIEND_REQUEST_UPDATE,
			d: {
				pair: { a: lo, b: hi },
				status: 'pending',
				by: from,
				created_at: now,
				instance_url: targetInstance
			}
		});
		this.logger.log(`Friend request: ${from.slice(0, 18)} -> ${to.slice(0, 18)}`);
		return row;
	}

	async acceptFriendRequest(actor: string, requester: string) {
		const pending = await this.findPendingBetween(actor, requester);
		if (!pending || (pending as any).requested_by === actor) {
			throw new NotFoundException('No pending request from this user');
		}
		const updated = await this.friendships.merge((pending as any).id, {
			status: 'accepted',
			updated_at: new Date()
		});
		const [lo, hi] = this.orderPair(actor, requester);
		const payload = { pair: { a: lo, b: hi }, status: 'accepted', by: actor };
		this.gateway?.emitToUser(actor, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
		this.gateway?.emitToUser(requester, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
		return updated;
	}

	async declineFriendRequest(actor: string, requester: string) {
		const pending = await this.findPendingBetween(actor, requester);
		if (!pending || (pending as any).requested_by === actor) {
			throw new NotFoundException('No pending request from this user');
		}
		await this.friendships.delete((pending as any).id);
		const [lo, hi] = this.orderPair(actor, requester);
		const payload = { pair: { a: lo, b: hi }, status: 'declined', by: actor };
		this.gateway?.emitToUser(actor, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
		this.gateway?.emitToUser(requester, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
	}

	async cancelFriendRequest(actor: string, recipient: string) {
		const pending = await this.findPendingBetween(actor, recipient);
		if (!pending || (pending as any).requested_by !== actor) {
			throw new NotFoundException('No outgoing request to this user');
		}
		await this.friendships.delete((pending as any).id);
		const [lo, hi] = this.orderPair(actor, recipient);
		const payload = { pair: { a: lo, b: hi }, status: 'cancelled', by: actor };
		this.gateway?.emitToUser(actor, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
		this.gateway?.emitToUser(recipient, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
	}

	async removeFriend(actor: string, other: string) {
		if (actor === other) throw new BadRequestException('Cannot unfriend yourself');
		const [lo, hi] = this.orderPair(actor, other);
		const row = await this.friendships.findOne({ user_a_id: lo, user_b_id: hi });
		if (!row) {
			throw new NotFoundException('Not a friend or pending');
		}
		const r = row as any;
		await this.friendships.delete(r.id);
		const status = r.status === 'accepted' ? 'removed' : 'cancelled';
		const payload = { pair: { a: lo, b: hi }, status, by: actor };
		this.gateway?.emitToUser(actor, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
		this.gateway?.emitToUser(other, { op: WsOp.FRIEND_REQUEST_UPDATE, d: payload });
	}

	// ── Block ──
	async block(actor: string, target: string) {
		if (actor === target) throw new BadRequestException('Cannot block yourself');
		const existing = await this.blocks.findOne({ blocker_id: actor, blocked_id: target });
		if (existing) return existing;

		// Strip friendship (in either direction + status) + ignore.
		const [lo, hi] = this.orderPair(actor, target);
		await this.friendships.deleteWhere({ user_a_id: lo, user_b_id: hi });
		await this.ignores.deleteWhere({ user_id: actor, ignored_id: target });

		const now = new Date();
		const row = await this.blocks.create({
			blocker_id: actor,
			blocked_id: target,
			created_at: now,
			updated_at: now
		});

		const targetInstance = await this.instanceFor(target);
		this.gateway?.emitToUser(actor, {
			op: WsOp.BLOCK_UPDATE,
			d: { target, blocked: true, instance_url: targetInstance }
		});
		// Synthesize the ignore clear + friendship clear for the actor's own other tabs.
		this.gateway?.emitToUser(actor, {
			op: WsOp.IGNORE_UPDATE,
			d: { target, ignored: false }
		});
		this.gateway?.emitToUser(actor, {
			op: WsOp.FRIEND_REQUEST_UPDATE,
			d: { pair: { a: lo, b: hi }, status: 'removed', by: actor }
		});
		this.gateway?.emitToUser(target, {
			op: WsOp.FRIEND_REQUEST_UPDATE,
			d: { pair: { a: lo, b: hi }, status: 'removed', by: actor }
		});
		this.logger.log(`Block: ${actor.slice(0, 18)} -> ${target.slice(0, 18)}`);
		return row;
	}

	async unblock(actor: string, target: string) {
		const existing = await this.blocks.findOne({ blocker_id: actor, blocked_id: target });
		if (!existing) throw new NotFoundException('Not blocked');
		await this.blocks.delete((existing as any).id);
		this.gateway?.emitToUser(actor, {
			op: WsOp.BLOCK_UPDATE,
			d: { target, blocked: false }
		});
	}

	// ── Ignore ──
	async ignore(actor: string, target: string) {
		if (actor === target) throw new BadRequestException('Cannot ignore yourself');
		if (await this.isBlocked(actor, target)) {
			throw new BadRequestException('User is blocked; unblock before ignoring');
		}
		const existing = await this.ignores.findOne({ user_id: actor, ignored_id: target });
		if (existing) return existing;

		const now = new Date();
		const row = await this.ignores.create({
			user_id: actor,
			ignored_id: target,
			created_at: now,
			updated_at: now
		});
		const targetInstance = await this.instanceFor(target);
		this.gateway?.emitToUser(actor, {
			op: WsOp.IGNORE_UPDATE,
			d: { target, ignored: true, instance_url: targetInstance }
		});
		return row;
	}

	async unignore(actor: string, target: string) {
		const existing = await this.ignores.findOne({ user_id: actor, ignored_id: target });
		if (!existing) throw new NotFoundException('Not ignored');
		await this.ignores.delete((existing as any).id);
		this.gateway?.emitToUser(actor, {
			op: WsOp.IGNORE_UPDATE,
			d: { target, ignored: false }
		});
	}

	// ── Paginated lists (for settings panels) ──
	async listBlocked(userId: string, options: { limit?: number; offset?: number; q?: string } = {}) {
		return this.blocks.findPage(
			{ blocker_id: userId },
			{
				sort: { field: 'created_at', order: 'desc' },
				limit: options.limit,
				offset: options.offset,
				search: options.q ? { fields: ['blocked_id'], query: options.q } : undefined
			}
		);
	}

	async listIgnored(userId: string, options: { limit?: number; offset?: number; q?: string } = {}) {
		return this.ignores.findPage(
			{ user_id: userId },
			{
				sort: { field: 'created_at', order: 'desc' },
				limit: options.limit,
				offset: options.offset,
				search: options.q ? { fields: ['ignored_id'], query: options.q } : undefined
			}
		);
	}

	async listFriends(userId: string, options: { limit?: number; offset?: number; q?: string } = {}) {
		const snapshot = await this.relationsFor(userId);
		const filtered = options.q
			? snapshot.friends.filter((d) => d.toLowerCase().includes(options.q!.toLowerCase()))
			: snapshot.friends;
		const start = options.offset ?? 0;
		const end = start + (options.limit ?? 50);
		return { items: filtered.slice(start, end).map((did) => ({ user_id: did })), total: filtered.length };
	}
}
