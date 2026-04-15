import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const AuditActionSchema = z.enum([
	'message_delete',
	'message_purge',
	'member_kick',
	'member_ban',
	'member_unban',
	'member_role_add',
	'member_role_remove',
	'role_create',
	'role_update',
	'role_delete',
	'channel_create',
	'channel_update',
	'channel_delete',
	'server_update',
	'invite_create',
	'invite_delete'
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditTargetKindSchema = z.enum([
	'message',
	'member',
	'role',
	'channel',
	'server',
	'invite'
]);

export type AuditTargetKind = z.infer<typeof AuditTargetKindSchema>;

export const AuditLogSchema = BaseEntitySchema.extend({
	server_id: z.string(),
	actor_id: z.string().describe('DID of who performed the action'),
	action: AuditActionSchema,
	target_kind: AuditTargetKindSchema,
	target_id: z.string().nullable(),
	target_user_id: z
		.string()
		.optional()
		.describe('DID of whom the action was against (indexed for per-user log queries)'),
	metadata: z.record(z.string(), z.unknown()).default({}),
	reason: z.string().max(512).optional(),
	batch_id: z
		.string()
		.optional()
		.describe('Shared across multiple audit rows from a single bulk action')
});

export type AuditLog = z.infer<typeof AuditLogSchema>;
