import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// ── Message types ──

export const MessageTypeSchema = z.enum(['text', 'system', 'reply']);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// ── Attachment ──

export const AttachmentSchema = z.object({
	url: z.string().url(),
	filename: z.string(),
	mime_type: z.string(),
	size: z.number().int(),
	width: z.number().int().optional(),
	height: z.number().int().optional()
});

export type Attachment = z.infer<typeof AttachmentSchema>;

// ── Embed ──

export const EmbedSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	url: z.string().url().optional(),
	thumbnail_url: z.string().url().optional(),
	site_name: z.string().optional(),
	color: z.string().optional(),
	/** Embeddable iframe URL for video platforms (YouTube, Vimeo, etc.) */
	embed_url: z.string().url().optional()
});

export type Embed = z.infer<typeof EmbedSchema>;

// ── Message ──

export const MessageSchema = BaseEntitySchema.extend({
	channel_id: z.string(),
	sender_id: z.string(),
	type: MessageTypeSchema.default('text'),
	content: z.string().min(1).max(4000),
	edited_at: z.date().optional(),
	reply_to: z
		.array(z.string())
		.max(5)
		.default([])
		.describe('Message IDs this is replying to (up to 5)'),
	attachments: z.array(AttachmentSchema).default([]),
	embeds: z.array(EmbedSchema).default([]),
	pinned: z.boolean().default(false),
	// Cryptographic signature fields
	signature: z.string().optional(),
	signer_did: z.string().optional(),
	signer_delegate_key: z.string().optional()
});

export type Message = z.infer<typeof MessageSchema>;

// ── Message input ──

export const CreateMessageSchema = z
	.object({
		channel_id: z.string(),
		content: z.string().max(4000).default(''),
		reply_to: z.array(z.string()).max(5).default([]),
		attachments: z.array(AttachmentSchema).default([])
	})
	.refine((v) => v.content.length > 0 || v.attachments.length > 0, {
		message: 'Message must have content or at least one attachment'
	});

export type CreateMessage = z.infer<typeof CreateMessageSchema>;
