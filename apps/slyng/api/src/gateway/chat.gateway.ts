import {
	WebSocketGateway,
	WebSocketServer,
	SubscribeMessage,
	OnGatewayConnection,
	OnGatewayDisconnect,
	MessageBody,
	ConnectedSocket
} from '@nestjs/websockets';
import type { AuthedRequest } from '../auth/authed-request';
import { Inject, Optional, Logger, forwardRef, type OnModuleInit } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import {
	WsOp,
	WsIdentifyPayloadSchema,
	WsPresenceUpdatePayloadSchema,
	WsSubscribePayloadSchema,
	WsTypingStartPayloadSchema,
	WsUnwatchProfilesPayloadSchema,
	WsVoiceStateUpdatePayloadSchema,
	WsWatchProfilesPayloadSchema,
	type WsIdentifyPayload,
	type WsPresenceUpdatePayload,
	type WsTypingStartPayload,
	type WsVoiceStateUpdatePayload,
	type WsWatchProfileEntry
} from '@slyng/types';
import { parseFrame, parseListField, type ListField } from './ws-payloads';
import { VoiceService } from '../voice/voice.service';
import { AuthService } from '../auth/auth.service';
import { UserRepository } from '../auth/user.repository';
import { MemberAccessService } from '../auth/member-access.service';
import { ProfileWatcherService } from '../profile-watcher/profile-watcher.service';
import { serializeForWire } from '../common/serialize';
import { describeError } from '../common/describe-error';
import { isChannelTopic } from '../common/channel-topics';

// Element contracts, read off the generated payload schemas rather than
// restated next to them. A second hand-written definition of a wire shape is
// exactly what drifted the first time — `WsUnwatchProfilesPayload.dids` spent
// its life declared required while the handler read it as optional.
const CHANNEL_TOPIC_ID = WsSubscribePayloadSchema.shape.channel_ids.element;
const WATCHED_DID = WsUnwatchProfilesPayloadSchema.shape.dids.unwrap().element;
const WATCH_PROFILE_ENTRY = WsWatchProfilesPayloadSchema.shape.profiles.element;

interface ClientState {
	userId: string | null;
	subscribedChannels: Set<string>;
	lastHeartbeat: number;
}

interface PresenceRecord {
	status: 'online' | 'idle' | 'dnd' | 'invisible';
	custom_status?: string;
	custom_emoji?: string;
}

@WebSocketGateway({ path: '/ws' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
	@WebSocketServer()
	server!: Server;

	private readonly logger = new Logger(ChatGateway.name);
	private clients = new Map<WebSocket, ClientState>();
	private userSockets = new Map<string, Set<WebSocket>>();
	// Per-user real status. Invisible users are stored truthfully here but
	// broadcast as 'offline' to everyone except themselves.
	private presences = new Map<string, PresenceRecord>();

	/** Status visible to other users (invisible → offline). */
	private publicStatus(userId: string): 'online' | 'idle' | 'dnd' | 'offline' {
		const p = this.presences.get(userId);
		if (!p) return 'offline';
		return p.status === 'invisible' ? 'offline' : p.status;
	}

	constructor(
		private readonly users: UserRepository,
		@Optional() @Inject(VoiceService) private readonly voiceService?: VoiceService,
		@Optional() @Inject(AuthService) private readonly authService?: AuthService,
		@Optional() @Inject(MemberAccessService) private readonly memberAccess?: MemberAccessService,
		@Optional() @Inject(forwardRef(() => ProfileWatcherService))
		private readonly profileWatcher?: ProfileWatcherService
	) {}

	/**
	 * `memberAccess` is `@Optional()` so the gateway can be constructed without
	 * the auth graph, but `GatewayModule` imports `AuthModule`, which exports
	 * `MemberAccessService` — so in a correctly wired app it is always present.
	 *
	 * Absent, every subscription authorisation below fails closed. That is the
	 * safe direction but a silent one, and a gateway that refuses every
	 * subscribe looks like a permissions bug rather than a wiring bug. Say so
	 * once, loudly, at boot.
	 */
	onModuleInit() {
		if (!this.memberAccess) {
			this.logger.error(
				'MemberAccessService was not injected — every SUBSCRIBE will be denied. ' +
					'Check that GatewayModule still imports AuthModule.'
			);
		}
	}

	async handleConnection(client: WebSocket, req: AuthedRequest) {
		this.clients.set(client, {
			userId: null,
			subscribedChannels: new Set(),
			lastHeartbeat: Date.now()
		});

		const cookieHeader: string | undefined = req?.headers?.cookie;
		this.logger.log(
			`WS connect total=${this.clients.size} cookie=${cookieHeader ? 'present' : 'MISSING'} authService=${this.authService ? 'yes' : 'no'}`
		);

		if (this.authService && cookieHeader) {
			const match = cookieHeader.match(/slyng_session=([^;]+)/);
			if (match) {
				this.logger.log(`WS auto-identify with token ${match[1].slice(0, 8)}...`);
				await this.handleIdentify(client, { token: match[1] });
			} else {
				this.logger.warn(`WS connect: cookie present but no slyng_session cookie`);
			}
		}
	}

	async handleDisconnect(client: WebSocket) {
		const state = this.clients.get(client);
		if (state?.userId) {
			const sockets = this.userSockets.get(state.userId);
			sockets?.delete(client);
			if (!sockets || sockets.size === 0) {
				this.userSockets.delete(state.userId);
				this.presences.delete(state.userId);
				// Broadcast offline to everyone
				this.broadcastPresenceUpdate(state.userId, { status: 'offline' });

				// Evict from any voice channel they were in — the client can't
				// send a clean VOICE_STATE_UPDATE on reload/crash, so the server
				// has to reconcile. Only on the LAST socket of this user so
				// that a second tab staying open doesn't kick them.
				if (this.voiceService) {
					try {
						const prev = await this.voiceService.leave(state.userId);
						if (prev) {
							this.broadcastToChannel(prev.server_id, {
								op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
								d: { user_id: state.userId, channel_id: null, action: 'leave' }
							});
						}
					} catch (err) {
						this.logger.warn(`Voice cleanup failed on disconnect: ${(err as Error).message}`);
					}
				}
			}
		}
		this.profileWatcher?.forgetClient(client);
		this.clients.delete(client);
	}

	@SubscribeMessage('message')
	handleMessage(
		@ConnectedSocket() client: WebSocket,
		@MessageBody() msg: { op: number; d: unknown }
	) {
		const state = this.clients.get(client);
		this.logger.log(`WS recv op=${msg.op} userId=${state?.userId?.slice(0, 24) ?? 'NONE'}`);
		try {
			switch (msg.op) {
				case WsOp.IDENTIFY: {
					const frame = parseFrame(WsIdentifyPayloadSchema, msg.d);
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.settle(msg.op, this.handleIdentify(client, frame.value));
					break;
				}
				case WsOp.HEARTBEAT:
					// No payload to check. The client sends `{"op":2,"d":null}` and
					// the handler reads nothing off `d`, so there is no contract
					// here to state or to violate.
					this.handleHeartbeat(client);
					break;
				case WsOp.SUBSCRIBE: {
					const frame = parseListField(msg.d, 'channel_ids', CHANNEL_TOPIC_ID, {
						optional: false
					});
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.noteSalvage(client, msg.op, 'channel_ids', frame.value);
					this.settle(msg.op, this.handleSubscribe(client, frame.value.items));
					break;
				}
				case WsOp.UNSUBSCRIBE: {
					// Same payload shape as SUBSCRIBE, deliberately sharing its
					// schema: there is no `WsUnsubscribePayload`, and if the two
					// frames ever diverge on the wire this is the seam to split.
					const frame = parseListField(msg.d, 'channel_ids', CHANNEL_TOPIC_ID, {
						optional: false
					});
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.noteSalvage(client, msg.op, 'channel_ids', frame.value);
					this.handleUnsubscribe(client, frame.value.items);
					break;
				}
				case WsOp.TYPING_START: {
					const frame = parseFrame(WsTypingStartPayloadSchema, msg.d);
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.handleTypingStart(client, frame.value);
					break;
				}
				case WsOp.PRESENCE_UPDATE: {
					const frame = parseFrame(WsPresenceUpdatePayloadSchema, msg.d);
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.settle(msg.op, this.handlePresenceUpdate(client, frame.value));
					break;
				}
				case WsOp.VOICE_STATE_UPDATE: {
					const frame = parseFrame(WsVoiceStateUpdatePayloadSchema, msg.d);
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.settle(msg.op, this.handleVoiceStateUpdate(client, frame.value));
					break;
				}
				case WsOp.WATCH_PROFILES: {
					const frame = parseListField(msg.d, 'profiles', WATCH_PROFILE_ENTRY, {
						optional: false
					});
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.noteSalvage(client, msg.op, 'profiles', frame.value);
					this.handleWatchProfiles(client, frame.value.items);
					break;
				}
				case WsOp.UNWATCH_PROFILES: {
					const frame = parseListField(msg.d, 'dids', WATCHED_DID, { optional: true });
					if (!frame.ok) {
						this.rejectFrame(client, msg.op, frame.reason);
						break;
					}
					this.noteSalvage(client, msg.op, 'dids', frame.value);
					// Absent is not the same as empty: no `dids` means drop every
					// watch this socket holds, `[]` means drop none. Collapsing the
					// two would silently leak watches on the disconnect path.
					this.handleUnwatchProfiles(client, frame.value.absent ? undefined : frame.value.items);
					break;
				}
				// Ops 100-102 (WebRTC signaling) removed — LiveKit handles media routing
			}
		} catch (err) {
			// Synchronous handlers. Nest's ws adapter already swallows these, but
			// silently — a thrown frame would vanish with no record of it.
			this.logger.error(`WS op=${msg.op} handler threw: ${describeError(err)}`);
		}
	}

	/**
	 * Keeps an async handler's failure scoped to the frame that caused it.
	 *
	 * `handleMessage` is synchronous and `@nestjs/platform-ws` wraps only the
	 * synchronous call, so a promise rejected by one of the handlers below has
	 * nowhere to go: Node's default turns an unhandled rejection into a process
	 * exit. Every payload here is a client-supplied `unknown` behind a cast, so
	 * one malformed frame from any authenticated socket was enough to take the
	 * API down — `{"op":6,"d":null}` reaching `data.status` did it.
	 *
	 * Handlers are dispatched fire-and-forget on purpose: a frame must not block
	 * the socket's read loop. So the fix is to give the rejection somewhere to
	 * go, not to await it.
	 */
	private settle(op: number, result: unknown) {
		if (result instanceof Promise) {
			result.catch((err) => this.logger.error(`WS op=${op} handler failed: ${describeError(err)}`));
		}
	}

	/**
	 * A frame that missed its op's contract: recorded, then dropped.
	 *
	 * The socket stays open on purpose. The realistic sender is a client one
	 * version behind or one bad entry deep, not an attacker, and closing on it
	 * would cost that client every subscription it holds — a worse outcome than
	 * the frame it got wrong. The op and the sender are enough to find it; the
	 * payload never goes in the line, because IDENTIFY's is a session token
	 * and PRESENCE_UPDATE's is user-authored text.
	 *
	 * Validation composes with `settle()` rather than replacing it: the checks
	 * in `ws-payloads.ts` stop what is recognisably garbage before a handler
	 * written against a shape it never verified ever sees it, and `settle()`
	 * still owns whatever a handler throws on a structurally valid frame.
	 *
	 * Every schema behind those checks comes from `@slyng/types`, generated
	 * from `packages/rust/slyng-types/src/ws.rs`, so the accepted shape is
	 * whatever that file says and it is the same contract the Rust client
	 * encodes against — keep the struct honest about what clients actually
	 * send rather than loosening the check here.
	 */
	private rejectFrame(client: WebSocket, op: number, reason: string) {
		const state = this.clients.get(client);
		this.logger.warn(
			`WS op=${op} rejected from ${state?.userId?.slice(0, 24) ?? 'unidentified'}: ${reason}`
		);
	}

	/**
	 * A list-bearing frame that lost entries to the element contract.
	 *
	 * Salvaging is the right call for frames that batch independent requests,
	 * but doing it silently would turn a client-side regression into a partial
	 * subscribe with no trace of it server-side, so any shortfall leaves a line
	 * saying how much of the frame survived.
	 */
	private noteSalvage(client: WebSocket, op: number, field: string, list: ListField<unknown>) {
		if (list.items.length === list.offered) return;
		const state = this.clients.get(client);
		this.logger.warn(
			`WS op=${op} off-contract ${field} from ${state?.userId?.slice(0, 24) ?? 'unidentified'}: ` +
				`kept ${list.items.length} of ${list.offered}`
		);
	}

	private async handleIdentify(client: WebSocket, data: WsIdentifyPayload) {
		const state = this.clients.get(client);
		if (!state || !this.authService) {
			this.logger.warn(`handleIdentify bail: state=${!!state} authService=${!!this.authService}`);
			return;
		}

		try {
			const session = await this.authService.getSession(data.token);
			if (!session) {
				this.logger.warn(`handleIdentify: no session for token ${data.token.slice(0, 8)}...`);
				this.send(client, { op: WsOp.READY, d: { error: 'invalid_session' } });
				return;
			}

			const tokenExpiry = new Date(session.token_expires_at);
			if (tokenExpiry < new Date()) {
				this.logger.warn(`handleIdentify: session expired ${tokenExpiry.toISOString()}`);
				this.send(client, { op: WsOp.READY, d: { error: 'session_expired' } });
				return;
			}

			state.userId = session.did;
			this.logger.log(`handleIdentify OK did=${session.did.slice(0, 24)}...`);

			// Load the user's last explicit presence preference from the DB so
			// DND/Invisible/custom status survives a disconnect + reconnect.
			// Falls back to 'online' for first-time connections.
			const userRecord = await this.users.findOne({ did: session.did });
			const saved = userRecord as
				| { preferred_status?: PresenceRecord['status']; custom_status?: string; custom_emoji?: string }
				| null;
			const isFirstSocket = !this.userSockets.has(state.userId);
			let sockets = this.userSockets.get(state.userId);
			if (!sockets) {
				sockets = new Set();
				this.userSockets.set(state.userId, sockets);
			}
			sockets.add(client);

			// Default presence on first connection — preserves any explicit
			// status set on a prior socket (multi-tab) instead of clobbering it,
			// and restores whatever the user had saved (DND/Invisible/custom status).
			if (isFirstSocket && !this.presences.has(state.userId)) {
				const validStatuses = ['online', 'idle', 'dnd', 'invisible'] as const;
				const status: PresenceRecord['status'] =
					saved?.preferred_status && (validStatuses as readonly string[]).includes(saved.preferred_status)
						? saved.preferred_status
						: 'online';
				this.presences.set(state.userId, {
					status,
					custom_status: saved?.custom_status,
					custom_emoji: saved?.custom_emoji
				});
			}

			// Snapshot of all currently-known presences for the new client
			const snapshot = Array.from(this.presences.entries()).map(([uid, p]) => ({
				user_id: uid,
				// Tell the user the truth about themselves; everyone else's invisible → offline
				status: uid === state.userId ? p.status : (p.status === 'invisible' ? 'offline' : p.status),
				custom_status: p.custom_status,
				custom_emoji: p.custom_emoji
			}));

			this.send(client, {
				op: WsOp.READY,
				d: { user_id: state.userId, presences: snapshot }
			});

			if (isFirstSocket) {
				const own = this.presences.get(state.userId)!;
				this.broadcastPresenceUpdate(state.userId, own);
			}
		} catch {
			this.send(client, { op: WsOp.READY, d: { error: 'auth_failed' } });
		}
	}

	private handleHeartbeat(client: WebSocket) {
		const state = this.clients.get(client);
		if (state) state.lastHeartbeat = Date.now();
		this.send(client, { op: WsOp.HEARTBEAT_ACK, d: null });
	}

	/** `channelIds` arrives element-checked from the dispatch switch. */
	private async handleSubscribe(client: WebSocket, channelIds: string[]) {
		const state = this.clients.get(client);
		if (!state?.userId) return;
		const userId = state.userId;

		// Clients send their whole topic list — the server plus every one of its
		// channels — in a single frame, and re-send it on every reconnect. The
		// channel topics are therefore authorised as a batch: one permission
		// fold per server instead of one full cascade per channel.
		//
		// Partitioned once, so `isChannelTopic` decides the split in exactly one
		// place and the loop below cannot disagree with the batch it was given.
		const channelTopics: string[] = [];
		const otherTopics: string[] = [];
		for (const id of channelIds) {
			(isChannelTopic(id) ? channelTopics : otherTopics).push(id);
		}

		const readable = await this.readableChannelTopics(userId, channelTopics);
		for (const id of channelTopics) {
			if (readable.has(id)) state.subscribedChannels.add(id);
		}
		for (const id of otherTopics) {
			// The server topic, and any future topic type: each resolves its own
			// server and passes when none applies.
			if (await this.canSubscribeToNonChannelTopic(userId, id)) {
				state.subscribedChannels.add(id);
			}
		}
	}

	/** `channelIds` arrives element-checked from the dispatch switch. */
	private handleUnsubscribe(client: WebSocket, channelIds: string[]) {
		const state = this.clients.get(client);
		if (!state) return;
		for (const id of channelIds) {
			state.subscribedChannels.delete(id);
		}
	}

	/**
	 * Batched authorisation for the `channel:` topics of a SUBSCRIBE frame, and
	 * the only thing that answers them.
	 *
	 * The failure *granularity* differs from the per-id loop this replaced: that
	 * caught per id, so a fault denied one topic. Here a fault inside
	 * `canReadChannels` denies only its own server's channels, but one escaping
	 * it — in practice the initial row read — denies every channel topic in the
	 * frame. Fail-closed in all three cases, including the one where the
	 * provider is missing: `assertDependencies` has already logged that at
	 * boot, and a gateway that cannot authorise must not subscribe anyone.
	 */
	private async readableChannelTopics(userId: string, topicIds: string[]): Promise<Set<string>> {
		if (!this.memberAccess) return new Set();
		if (!topicIds.length) return new Set();
		try {
			return await this.memberAccess.canReadChannels(userId, topicIds);
		} catch (err) {
			// `err instanceof Error ? … : String(err)`, not `(err as Error).message`:
			// a thrown `null` makes the latter raise inside the catch, which
			// escapes the one function whose whole contract is that nothing does.
			this.logger.warn(`Channel topic authorisation failed: ${describeError(err)}`);
			return new Set();
		}
	}

	/**
	 * Authorisation for the topics that are not channels — the server topic the
	 * layout subscribes to for server-wide events, and any future topic type.
	 * The subscribing user must be a member of the resolved server and not
	 * banned; a topic that resolves to no server passes, so a new topic type
	 * does not require a guard update.
	 *
	 * Deliberately has no `channel:` case — `handleSubscribe` partitions those
	 * off and answers the whole batch through `readableChannelTopics`. Adding
	 * one back would be a second answer to a question that already has one.
	 */
	private async canSubscribeToNonChannelTopic(userId: string, topicId: string): Promise<boolean> {
		if (!this.memberAccess) return false;
		try {
			const serverId = await this.memberAccess.resolveServerId(topicId);
			if (!serverId) return true;
			return await this.memberAccess.isAllowed(userId, serverId);
		} catch {
			return false;
		}
	}

	/**
	 * Drop every server + channel topic for `userId`'s sockets and evict them
	 * from any voice channel they're in within this server. Called right after
	 * a kick / ban so the victim stops receiving events immediately.
	 */
	async evictUserFromServer(userId: string, serverId: string, channelIds: string[]): Promise<void> {
		const topicSet = new Set<string>([serverId, ...channelIds]);
		const sockets = this.userSockets.get(userId);
		if (sockets) {
			for (const sock of sockets) {
				const state = this.clients.get(sock);
				if (!state) continue;
				for (const id of topicSet) state.subscribedChannels.delete(id);
			}
		}

		// Voice eviction: if they're in a voice channel of this server, yank
		// them out and broadcast the leave to remaining participants.
		if (this.voiceService) {
			const current = this.voiceService.getUserState(userId);
			if (current && topicSet.has(current.channel_id)) {
				await this.voiceService.leave(userId);
				this.broadcastToChannel(current.server_id || serverId, {
					op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
					d: { user_id: userId, channel_id: null, action: 'leave' }
				});
			}
		}
	}

	/**
	 * `profiles` arrives element-checked from the dispatch switch — the
	 * `Array.isArray` guard this used to carry now lives there, where a
	 * non-array is rejected instead of quietly no-op'd.
	 */
	private handleWatchProfiles(client: WebSocket, profiles: WsWatchProfileEntry[]) {
		if (!this.profileWatcher) return;
		this.profileWatcher.register(client, profiles);
	}

	/** `undefined` drops every watch on this socket; a list drops just those. */
	private handleUnwatchProfiles(client: WebSocket, dids: string[] | undefined) {
		if (!this.profileWatcher) return;
		this.profileWatcher.unregister(client, dids);
	}

	private handleTypingStart(client: WebSocket, data: WsTypingStartPayload) {
		const state = this.clients.get(client);
		if (!state?.userId) return;

		this.broadcastToChannel(data.channel_id, {
			op: WsOp.TYPING_START_BROADCAST,
			d: { channel_id: data.channel_id, user_id: state.userId }
		}, state.userId); // exclude sender
	}

	private async handlePresenceUpdate(client: WebSocket, data: WsPresenceUpdatePayload) {
		const state = this.clients.get(client);
		if (!state?.userId) {
			this.logger.warn(`handlePresenceUpdate bail: not authenticated`);
			return;
		}
		this.logger.log(`handlePresenceUpdate did=${state.userId.slice(0, 24)} data=${JSON.stringify(data)}`);

		const valid = ['online', 'idle', 'dnd', 'invisible'] as const;
		const current = this.presences.get(state.userId) ?? { status: 'online' as const };
		const next: PresenceRecord = {
			status: (valid as readonly string[]).includes(data.status ?? '')
				? (data.status as PresenceRecord['status'])
				: current.status,
			custom_status: data.custom_status === undefined ? current.custom_status : (data.custom_status || undefined),
			custom_emoji: data.custom_emoji === undefined ? current.custom_emoji : (data.custom_emoji || undefined)
		};
		this.presences.set(state.userId, next);
		this.broadcastPresenceUpdate(state.userId, next);

		// Persist so status + custom message survive disconnect. Auto-idle is
		// transient, so don't touch preferred_status when the incoming change
		// is 'idle'. Custom status/emoji always persist (they're user input).
		const userRecord = await this.users.findOne({ did: state.userId });
		if (userRecord) {
			const patch: Record<string, unknown> = {
				custom_status: next.custom_status ?? null,
				custom_emoji: next.custom_emoji ?? null,
				updated_at: new Date()
			};
			if (next.status !== 'idle') patch.preferred_status = next.status;
			await this.users.merge(userRecord.id, patch);
		}
	}

	// ── Voice handlers ──

	/**
	 * Op 7. The audio/video flags are a patch, not a snapshot — see
	 * `WsVoiceStateUpdatePayload` in `packages/rust/slyng-types/src/ws.rs`
	 * for the four shapes the voice engines send. `channel_id` carries the
	 * join-vs-leave decision: a channel id joins or updates, an explicit
	 * `null` (which is what both engines send on leave) leaves.
	 *
	 * The key itself is never absent by the time we get here — the schema
	 * requires it, so a frame that forgot it is rejected upstream rather
	 * than falling through to the leave branch and yanking someone out of
	 * a call they never asked to leave.
	 *
	 * The leave test is `=== null`, not `!data.channel_id`, and the
	 * difference is the whole point of typing the field `string | null`.
	 * Truthiness reads `''` as a leave, so a frame carrying a blank id —
	 * which no send site produces, but which the schema cannot rule out —
	 * would silently disconnect the sender from voice. Against an exact
	 * null it falls through to the join path instead, where
	 * `VoiceService.join` throws `NotFoundException` before it mutates any
	 * state. Broken input fails loudly and changes nothing, rather than
	 * quietly doing the one thing the user didn't ask for.
	 */
	private async handleVoiceStateUpdate(client: WebSocket, data: WsVoiceStateUpdatePayload) {
		const state = this.clients.get(client);
		if (!state?.userId || !this.voiceService) return;

		if (data.channel_id === null) {
			// Disconnect from voice
			const prev = await this.voiceService.leave(state.userId);
			if (prev) {
				// Broadcast to server topic so all server members see it (not just voice participants)
				this.broadcastToChannel(prev.server_id, {
					op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
					d: { user_id: state.userId, channel_id: null, action: 'leave' }
				});
			}
			return;
		}

		// Check if user is already in this channel AND this is explicitly a state
		// update (has video flags). Plain join messages (self_mute + self_deaf only)
		// must always go through the full join path to handle tab-reload races
		// where the old socket hasn't disconnected yet.
		const isVideoStateUpdate = data.has_camera !== undefined || data.has_screen !== undefined;
		const existingState = this.voiceService.getUserState(state.userId);
		if (existingState && existingState.channel_id === data.channel_id && isVideoStateUpdate) {
			// State update (mute/deaf/camera/screen toggle)
			if (data.self_mute !== undefined || data.self_deaf !== undefined) {
				await this.voiceService.updateState(state.userId, data.self_mute ?? existingState.self_mute, data.self_deaf ?? existingState.self_deaf);
			}
			if (data.has_camera !== undefined || data.has_screen !== undefined) {
				this.voiceService.updateVideoState(state.userId, data.has_camera ?? existingState.has_camera, data.has_screen ?? existingState.has_screen);
			}
			const updated = this.voiceService.getUserState(state.userId)!;
			this.broadcastToChannel(updated.server_id, {
				op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
				d: {
					user_id: state.userId,
					channel_id: data.channel_id,
					self_mute: updated.self_mute,
					self_deaf: updated.self_deaf,
					has_camera: updated.has_camera,
					has_screen: updated.has_screen,
					action: 'state_update'
				}
			}, state.userId);
			return;
		}

		// Join voice channel
		const voiceState = await this.voiceService.join(state.userId, data.channel_id, '');

		// Auto-subscribe to voice channel (for signaling) and server topic (for state broadcasts)
		state.subscribedChannels.add(data.channel_id);
		if (voiceState.server_id) state.subscribedChannels.add(voiceState.server_id);

		// Broadcast join to server topic so all server members see it
		this.broadcastToChannel(voiceState.server_id, {
			op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
			d: {
				user_id: state.userId,
				channel_id: data.channel_id,
				self_mute: voiceState.self_mute,
				self_deaf: voiceState.self_deaf,
				has_camera: voiceState.has_camera,
				has_screen: voiceState.has_screen,
				action: 'join'
			}
		}, state.userId);

		// Send list of current channel users to the joiner
		const channelUsers = this.voiceService.getChannelUsers(data.channel_id);
		this.send(client, {
			op: WsOp.VOICE_STATE_UPDATE_BROADCAST,
			d: {
				channel_id: data.channel_id,
				users: channelUsers.map((u) => ({
					user_id: u.user_id,
					self_mute: u.self_mute,
					self_deaf: u.self_deaf,
					has_camera: u.has_camera,
					has_screen: u.has_screen
				})),
				action: 'channel_users'
			}
		});
	}


	// ── Public methods for REST controllers to emit events ──

	emitToChannel(channelId: string, event: { op: number; d: unknown }) {
		this.broadcastToChannel(channelId, event);
	}

	/**
	 * Broadcast to anyone subscribed to the server topic (i.e. anyone currently
	 * viewing the server). Channel create/update/delete events use this so that
	 * sidebars stay in sync without requiring the new channel id to already be
	 * subscribed.
	 */
	emitToServer(serverId: string, event: { op: number; d: unknown }) {
		this.broadcastToChannel(serverId, event);
	}

	/**
	 * Tell every connected client that the given user's profile/stories hash
	 * has changed — they should invalidate their cache and re-fetch.
	 */
	broadcastProfileUpdate(did: string) {
		const event = { op: WsOp.PROFILE_UPDATE, d: { did } };
		for (const [ws, state] of this.clients) {
			if (!state.userId) continue;
			this.send(ws, event);
		}
	}

	emitToUser(userId: string, event: { op: number; d: unknown }) {
		const sockets = this.userSockets.get(userId);
		if (!sockets) return;
		for (const ws of sockets) {
			this.send(ws, event);
		}
	}

	/**
	 * Return the distinct set of user IDs currently subscribed to the given
	 * channel topic. Used by services that need to target privileged viewers
	 * (e.g. follow-up un-masked broadcast of soft-deleted messages to users
	 * holding `VIEW_REMOVED_MESSAGES`).
	 */
	getChannelSubscribers(channelId: string): Set<string> {
		const out = new Set<string>();
		for (const [, state] of this.clients) {
			if (state.userId && state.subscribedChannels.has(channelId)) {
				out.add(state.userId);
			}
		}
		return out;
	}

	// ── Internal helpers ──

	private broadcastToChannel(channelId: string, event: { op: number; d: unknown }, excludeUserId?: string) {
		for (const [ws, state] of this.clients) {
			if (state.subscribedChannels.has(channelId) && state.userId !== excludeUserId) {
				this.send(ws, event);
			}
		}
	}

	private broadcastPresenceUpdate(userId: string, presence: PresenceRecord | { status: 'offline' }) {
		this.logger.log(
			`broadcastPresenceUpdate did=${userId.slice(0, 24)} status=${presence.status} recipients=${this.clients.size}`
		);

		const isOffline = (presence as { status: string }).status === 'offline';
		const isInvisible = (presence as PresenceRecord).status === 'invisible';

		// Public payload — invisible appears as offline to others, no custom status
		const publicPayload = isOffline || isInvisible
			? { user_id: userId, status: 'offline' as const }
			: {
				user_id: userId,
				status: (presence as PresenceRecord).status,
				custom_status: (presence as PresenceRecord).custom_status,
				custom_emoji: (presence as PresenceRecord).custom_emoji
			};

		// Self-payload — show the user their real status
		const selfPayload = isOffline
			? { user_id: userId, status: 'offline' as const }
			: {
				user_id: userId,
				status: (presence as PresenceRecord).status,
				custom_status: (presence as PresenceRecord).custom_status,
				custom_emoji: (presence as PresenceRecord).custom_emoji
			};

		for (const [ws, state] of this.clients) {
			if (!state.userId) continue;
			const payload = state.userId === userId ? selfPayload : publicPayload;
			this.send(ws, { op: WsOp.PRESENCE_UPDATE_BROADCAST, d: payload });
		}
	}

	private send(client: WebSocket, data: unknown) {
		if (client.readyState !== WebSocket.OPEN) return;
		// Encode SurrealDB RecordId / Date instances the same way HTTP responses
		// do. Without this, broadcast rows arrive as `{tb, id}` and frontend
		// matchers (which compare against canonical "table:id" strings) silently
		// drop the event — the original symptom that motivated Block 12.
		client.send(JSON.stringify(serializeForWire(data)));
	}
}
