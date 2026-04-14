import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const ReactionKindSchema = z.enum(['unicode', 'custom_emoji']);
export type ReactionKind = z.infer<typeof ReactionKindSchema>;

export const MessageReactionSchema = BaseEntitySchema.extend({
	message_id: z.string(),
	user_id: z.string(),
	kind: ReactionKindSchema,
	value: z.string().describe('Emoji unicode char or custom emoji shortcode'),
	image_url: z.string().url().optional().describe('URL for custom emoji image')
});

export type MessageReaction = z.infer<typeof MessageReactionSchema>;
