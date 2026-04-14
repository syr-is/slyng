import { z } from 'zod';

export const PresenceStatusSchema = z.enum(['online', 'idle', 'dnd', 'invisible', 'offline']);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export const PresenceSchema = z.object({
	user_id: z.string(),
	status: PresenceStatusSchema,
	last_seen_at: z.date().optional(),
	custom_status: z.string().max(128).optional(),
	custom_emoji: z.string().max(32).optional()
});

export type Presence = z.infer<typeof PresenceSchema>;
