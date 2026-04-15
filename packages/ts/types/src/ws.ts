import { z } from 'zod';
import { PresenceStatusSchema } from './presence.js';

/**
 * WebSocket opcodes and event payload schemas.
 * All WS messages are JSON: { op: number, d: payload }
 */

// ── Opcodes ──

export const WsOp = {
	// Client → Server
	IDENTIFY: 1,
	HEARTBEAT: 2,
	SUBSCRIBE: 3,
	UNSUBSCRIBE: 4,
	TYPING_START: 5,
	PRESENCE_UPDATE: 6,
	VOICE_STATE_UPDATE: 7,

	// Server → Client
	READY: 10,
	HEARTBEAT_ACK: 11,
	MESSAGE_CREATE: 20,
	MESSAGE_UPDATE: 21,
	MESSAGE_DELETE: 22,
	TYPING_START_BROADCAST: 25,
	PRESENCE_UPDATE_BROADCAST: 26,
	CHANNEL_CREATE: 28,
	CHANNEL_DELETE: 29,
	CHANNEL_UPDATE: 30,
	MEMBER_UPDATE: 31,
	MEMBER_REMOVE: 32,
	ROLE_CREATE: 33,
	ROLE_UPDATE: 34,
	ROLE_DELETE: 35,
	VOICE_STATE_UPDATE_BROADCAST: 36,
	SERVER_UPDATE: 37,
	SERVER_DELETE: 38,
	REACTION_ADD: 40,
	REACTION_REMOVE: 41,
	PIN_ADD: 42,
	PIN_REMOVE: 43,
	AUDIT_LOG_APPEND: 44,

	// Profile watcher — federated hash polling
	WATCH_PROFILES: 50,
	UNWATCH_PROFILES: 51,
	PROFILE_UPDATE: 52
} as const;

// ── Client → Server payloads ──

export const WsIdentifySchema = z.object({
	token: z.string().describe('Session cookie value')
});

export const WsSubscribeSchema = z.object({
	channel_ids: z.array(z.string())
});

export const WsTypingStartSchema = z.object({
	channel_id: z.string()
});

export const WsPresenceUpdateSchema = z.object({
	status: PresenceStatusSchema,
	custom_status: z.string().max(128).optional()
});

export const WsVoiceStateUpdateSchema = z.object({
	channel_id: z.string().optional().describe('null = disconnect'),
	self_mute: z.boolean().default(false),
	self_deaf: z.boolean().default(false)
});

// ── Server → Client payloads ──

export const WsReadySchema = z.object({
	user_id: z.string(),
	servers: z.array(z.object({
		id: z.string(),
		name: z.string(),
		icon_url: z.string().optional(),
		channels: z.array(z.object({
			id: z.string(),
			name: z.string().optional(),
			type: z.string(),
			position: z.number().default(0)
		}))
	})),
	dm_channels: z.array(z.object({
		id: z.string(),
		participants: z.array(z.string())
	})),
	presences: z.array(z.object({
		user_id: z.string(),
		status: PresenceStatusSchema
	})),
	unread: z.array(z.object({
		channel_id: z.string(),
		count: z.number(),
		mention_count: z.number()
	}))
});

// ── Generic WS message wrapper ──

export const WsMessageSchema = z.object({
	op: z.number(),
	d: z.unknown()
});

export type WsMessage = z.infer<typeof WsMessageSchema>;
