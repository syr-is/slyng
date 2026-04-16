import {
	WebSocketGateway,
	WebSocketServer,
	SubscribeMessage,
	OnGatewayConnection,
	OnGatewayDisconnect,
	MessageBody,
	ConnectedSocket
} from '@nestjs/websockets';
import { Inject, Optional, Logger, forwardRef } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { WsOp } from '@syren/types';
import { VoiceService } from '../voice/voice.service';
import { AuthService } from '../auth/auth.service';
import { UserRepository } from '../auth/user.repository';
import { MemberAccessService } from '../auth/member-access.service';
import { ProfileWatcherService } from '../profile-watcher/profile-watcher.service';
import { serializeForWire } from '../common/serialize';

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
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
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

	async handleConnection(client: WebSocket, req: any) {
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
			const match = cookieHeader.match(/syren_session=([^;]+)/);
			if (match) {
				this.logger.log(`WS auto-identify with token ${match[1].slice(0, 8)}...`);
				await this.handleIdentify(client, { token: match[1] });
			} else {
				this.logger.warn(`WS connect: cookie present but no syren_session cookie`);
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
		switch (msg.op) {
			case WsOp.IDENTIFY:
				this.handleIdentify(client, msg.d as { token: string });
				break;
			case WsOp.HEARTBEAT:
				this.handleHeartbeat(client);
				break;
			case WsOp.SUBSCRIBE:
				this.handleSubscribe(client, msg.d as { channel_ids: string[] });
				break;
			case WsOp.UNSUBSCRIBE:
				this.handleUnsubscribe(client, msg.d as { channel_ids: string[] });
				break;
			case WsOp.TYPING_START:
				this.handleTypingStart(client, msg.d as { channel_id: string });
				break;
			case WsOp.PRESENCE_UPDATE:
				this.handlePresenceUpdate(client, msg.d as { status: string });
				break;
			case WsOp.VOICE_STATE_UPDATE:
				this.handleVoiceStateUpdate(client, msg.d as any);
				break;
			case WsOp.WATCH_PROFILES:
				this.handleWatchProfiles(client, msg.d as { profiles: { did: string; instance_url: string }[] });
				break;
			case WsOp.UNWATCH_PROFILES:
				this.handleUnwatchProfiles(client, msg.d as { dids?: string[] });
				break;
			// Ops 100-102 (WebRTC signaling) removed — LiveKit handles media routing
		}
	}

	private async handleIdentify(client: WebSocket, data: { token: string }) {
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

	private async handleSubscribe(client: WebSocket, data: { channel_ids: string[] }) {
		const state = this.clients.get(client);
		if (!state?.userId) return;
		for (const id of data.channel_ids) {
			// Only subscribe to topics the user is actually allowed to read.
			// The check short-circuits unrelated topics (e.g. DM channels if we
			// add them later) by returning true when no server context applies.
			const allowed = await this.canSubscribe(state.userId, id);
			if (allowed) state.subscribedChannels.add(id);
		}
	}

	private handleUnsubscribe(client: WebSocket, data: { channel_ids: string[] }) {
		const state = this.clients.get(client);
		if (!state) return;
		for (const id of data.channel_ids) {
			state.subscribedChannels.delete(id);
		}
	}

	/**
	 * Authorisation check for a SUBSCRIBE topic. The topic may be a server id
	 * (the layout subscribes to it for server-wide events) or a channel id.
	 * Either way, the subscribing user must be a member of the resolved
	 * server and not banned. Returns true on topics outside the server model
	 * (no server resolved) so new topic types don't require guard updates.
	 */
	private async canSubscribe(userId: string, topicId: string): Promise<boolean> {
		if (!this.memberAccess) return true;
		try {
			const serverId = await this.memberAccess.resolveServerId(topicId);
			if (!serverId) return true;
			if (!(await this.memberAccess.isAllowed(userId, serverId))) return false;
			// Channel-level READ_MESSAGES check
			if (topicId.startsWith('channel:')) {
				return this.memberAccess.canReadChannel(userId, topicId);
			}
			return true;
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

	private handleWatchProfiles(
		client: WebSocket,
		data: { profiles: { did: string; instance_url: string }[] }
	) {
		if (!this.profileWatcher || !Array.isArray(data?.profiles)) return;
		this.profileWatcher.register(client, data.profiles);
	}

	private handleUnwatchProfiles(client: WebSocket, data: { dids?: string[] }) {
		if (!this.profileWatcher) return;
		this.profileWatcher.unregister(client, data?.dids);
	}

	private handleTypingStart(client: WebSocket, data: { channel_id: string }) {
		const state = this.clients.get(client);
		if (!state?.userId) return;

		this.broadcastToChannel(data.channel_id, {
			op: WsOp.TYPING_START_BROADCAST,
			d: { channel_id: data.channel_id, user_id: state.userId }
		}, state.userId); // exclude sender
	}

	private async handlePresenceUpdate(
		client: WebSocket,
		data: { status?: string; custom_status?: string; custom_emoji?: string }
	) {
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
			await this.users.merge((userRecord as any).id, patch);
		}
	}

	// ── Voice handlers ──

	private async handleVoiceStateUpdate(client: WebSocket, data: { channel_id?: string; self_mute?: boolean; self_deaf?: boolean; has_camera?: boolean; has_screen?: boolean }) {
		const state = this.clients.get(client);
		if (!state?.userId || !this.voiceService) return;

		if (!data.channel_id) {
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
