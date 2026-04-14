import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// ── Channel types ──

export const ChannelTypeSchema = z.enum(['text', 'voice', 'direct', 'group']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

// ── Channel ──

export const ChannelSchema = BaseEntitySchema.extend({
	type: ChannelTypeSchema,
	name: z.string().optional().describe('Channel name; null for DMs'),
	topic: z.string().max(1024).optional(),
	server_id: z.string().optional().describe('null = DM/group DM outside any server'),
	category_id: z.string().optional(),
	position: z.number().int().min(0).default(0),
	created_by: z.string().describe('User ID of channel creator'),
	last_message_at: z.date().optional()
});

export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelSchema = z.object({
	type: ChannelTypeSchema.default('text'),
	name: z.string().min(1).max(100),
	topic: z.string().max(1024).optional(),
	category_id: z.string().optional()
});

export type CreateChannel = z.infer<typeof CreateChannelSchema>;

// ── Channel participant (DMs) ──

export const ParticipantRoleSchema = z.enum(['owner', 'admin', 'member']);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const ChannelParticipantSchema = BaseEntitySchema.extend({
	channel_id: z.string(),
	user_id: z.string(),
	role: ParticipantRoleSchema.default('member'),
	last_read_at: z.date().optional(),
	joined_at: z.date()
});

export type ChannelParticipant = z.infer<typeof ChannelParticipantSchema>;
