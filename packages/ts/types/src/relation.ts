import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// ── Friendship ──
//
// Stored as an ordered pair (lex-smaller DID first) so bidirectional queries
// deduplicate to a single row. `requested_by` remembers direction for
// incoming/outgoing splits. Status transitions: pending → accepted, or
// pending → (deleted via decline/cancel).

export const FriendshipStatusSchema = z.enum(['pending', 'accepted']);
export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

export const FriendshipSchema = BaseEntitySchema.extend({
	user_a_id: z.string().describe('Lex-smaller DID of the pair'),
	user_b_id: z.string().describe('Lex-larger DID of the pair'),
	status: FriendshipStatusSchema,
	requested_by: z.string().describe('DID that sent the request')
});
export type Friendship = z.infer<typeof FriendshipSchema>;

// ── Block (unidirectional) ──
export const UserBlockSchema = BaseEntitySchema.extend({
	blocker_id: z.string(),
	blocked_id: z.string()
});
export type UserBlock = z.infer<typeof UserBlockSchema>;

// ── Ignore (unidirectional) ──
export const UserIgnoreSchema = BaseEntitySchema.extend({
	user_id: z.string(),
	ignored_id: z.string()
});
export type UserIgnore = z.infer<typeof UserIgnoreSchema>;

// ── User policy enums ──
export const AllowDmsSchema = z.enum(['open', 'friends_only', 'closed']);
export type AllowDms = z.infer<typeof AllowDmsSchema>;

export const AllowFriendRequestsSchema = z.enum(['open', 'mutual', 'closed']);
export type AllowFriendRequests = z.infer<typeof AllowFriendRequestsSchema>;

// ── canDM result for the message-send gate ──
export const CanDmResultSchema = z.discriminatedUnion('allowed', [
	z.object({ allowed: z.literal(true) }),
	z.object({
		allowed: z.literal(false),
		reason: z.enum(['blocked', 'dm_closed', 'dm_friends_only'])
	})
]);
export type CanDmResult = z.infer<typeof CanDmResultSchema>;
