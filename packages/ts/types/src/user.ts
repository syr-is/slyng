import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// ── User profile (synced from syr via OAuth) ──

export const UserSchema = BaseEntitySchema.extend({
	syr_id: z.string().describe('User ID from syr (DID or handle)'),
	did: z.string().optional().describe('The user\'s DID (did:syr:...)'),
	handle: z.string().min(1),
	display_name: z.string().optional(),
	avatar_url: z.string().url().optional(),
	bio: z.string().optional(),
	syr_instance_url: z.string().url().optional().describe('The syr instance this user belongs to'),
	delegate_public_key: z.string().optional().describe('Platform delegate public key for verification'),
	last_seen_at: z.date().optional(),
	is_online: z.boolean().default(false),
	has_instance: z.boolean().default(false).describe('Whether user has linked a syr instance')
});

export type User = z.infer<typeof UserSchema>;

// ── Platform session (replaces OAuth session) ──

export const PlatformSessionSchema = BaseEntitySchema.extend({
	user_id: z.string(),
	platform_token: z.string().describe('Token for signing-as-a-service requests'),
	delegate_public_key: z.string().describe('Platform delegate public key'),
	did: z.string(),
	token_expires_at: z.date(),
	syr_instance_url: z.string().url()
});

export type PlatformSession = z.infer<typeof PlatformSessionSchema>;
