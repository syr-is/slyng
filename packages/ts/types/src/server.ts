import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// ── Server (Guild) ──

export const ServerSchema = BaseEntitySchema.extend({
	name: z.string().min(1).max(100),
	icon_url: z.string().url().optional(),
	banner_url: z.string().url().optional().describe('Banner shown atop channel sidebar'),
	invite_background_url: z.string().url().optional().describe('Background on invite landing page'),
	description: z.string().max(1000).optional(),
	owner_id: z.string().describe('DID of the server owner'),
	member_count: z.number().int().min(0).default(0)
});

export type Server = z.infer<typeof ServerSchema>;

export const CreateServerSchema = z.object({
	name: z.string().min(1).max(100),
	icon_url: z.string().url().optional(),
	banner_url: z.string().url().optional(),
	invite_background_url: z.string().url().optional(),
	description: z.string().max(1000).optional()
});

export type CreateServer = z.infer<typeof CreateServerSchema>;

// ── Server Member ──

export const ServerMemberSchema = BaseEntitySchema.extend({
	server_id: z.string(),
	user_id: z.string(),
	nickname: z.string().max(32).optional(),
	role_ids: z.array(z.string()).default([]),
	joined_at: z.date()
});

export type ServerMember = z.infer<typeof ServerMemberSchema>;

// ── Server Role ──

export const ServerRoleSchema = BaseEntitySchema.extend({
	server_id: z.string(),
	name: z.string().min(1).max(100),
	color: z.string().optional().describe('Hex color, e.g. #ff5733'),
	position: z.number().int().min(0).default(0),
	permissions: z.string().default('0').describe('BigInt permission flags as string'),
	is_default: z.boolean().default(false)
});

export type ServerRole = z.infer<typeof ServerRoleSchema>;

// ── Server Invite ──

export const ServerInviteSchema = BaseEntitySchema.extend({
	server_id: z.string(),
	code: z.string().min(6).max(16),
	created_by: z.string(),
	expires_at: z.date().optional(),
	max_uses: z.number().int().min(0).default(0).describe('0 = unlimited'),
	uses: z.number().int().min(0).default(0)
});

export type ServerInvite = z.infer<typeof ServerInviteSchema>;

export const CreateInviteSchema = z.object({
	max_uses: z.number().int().min(0).default(0),
	expires_in: z.number().int().min(0).optional().describe('Seconds until expiry, 0 or omit = never')
});

export type CreateInvite = z.infer<typeof CreateInviteSchema>;

// ── Channel Category ──

export const ChannelCategorySchema = BaseEntitySchema.extend({
	server_id: z.string(),
	name: z.string().min(1).max(100),
	position: z.number().int().min(0).default(0)
});

export type ChannelCategory = z.infer<typeof ChannelCategorySchema>;
