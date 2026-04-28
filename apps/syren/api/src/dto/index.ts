/**
 * Input DTOs for every controller `@Body()`. Each one is a
 * `createZodDto(schema)` class — the global `ZodValidationPipe`
 * (registered in `app.module.ts`) runs the schema against the request
 * body before the handler is invoked.
 *
 * `nestjs-zod` v5 ties its DTO instance type to
 * `ReturnType<TSchema['parse']>` against an `UnknownSchema` constraint
 * whose `parse` returns `unknown`. With Zod 4's `this`-typed parse
 * signature that collapses to `unknown`, so a plain
 * `class FooDto extends createZodDto(FooSchema) {}` ends up with no
 * accessible properties on the instance.
 *
 * `dto(schema)` wraps `createZodDto` and casts the result to a
 * constructor that explicitly returns `z.infer<typeof schema>`, so the
 * `extends` site preserves the schema's shape on the class instance.
 * The runtime class is unchanged — `nestjs-zod`'s metadata
 * (`isZodDto`, `.schema`) is still in place; we only fix the static
 * typing.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
	BanMemberInputSchema,
	ChannelReorderInputSchema,
	ExchangeRequestSchema,
	LoginRequestSchema,
	PurgeMessagesInputSchema,
	UpdateInviteInputSchema,
	UpsertOverrideInputSchema
} from '@syren/types';

function dto<S extends z.ZodTypeAny>(schema: S): new () => z.infer<S> {
	return createZodDto(schema as never) as unknown as new () => z.infer<S>;
}

// ── Auth ────────────────────────────────────────────────────────────

export class LoginDto extends dto(LoginRequestSchema) {}
export class ExchangeDto extends dto(ExchangeRequestSchema) {}

// ── Server ──────────────────────────────────────────────────────────

const CreateServerSchema = z.object({
	name: z.string().min(1).max(100),
	icon_url: z.string().url().optional(),
	banner_url: z.string().url().optional(),
	invite_background_url: z.string().url().optional(),
	description: z.string().max(1000).optional()
});
export class CreateServerDto extends dto(CreateServerSchema) {}

const UpdateServerSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(1000).optional(),
	icon_url: z.string().url().optional(),
	banner_url: z.string().url().optional(),
	invite_background_url: z.string().url().optional()
});
export class UpdateServerDto extends dto(UpdateServerSchema) {}

const TransferOwnershipSchema = z.object({
	new_owner_id: z.string().min(1)
});
export class TransferOwnershipDto extends dto(TransferOwnershipSchema) {}

// Hand-written rather than reusing `CreateInviteInputSchema` because the
// generated version uses `.nullable().optional()` for every Option<T>
// field — the wire format is tolerant, but the service signatures
// downstream are typed `T | undefined` and reject explicit `null`.
const CreateInviteSchema = z.object({
	max_uses: z.number().int().min(0).optional(),
	expires_in: z.number().int().min(0).optional(),
	target_kind: z.enum(['open', 'instance', 'did']).optional(),
	target_value: z.string().optional(),
	label: z.string().max(64).optional()
});
export class CreateInviteDto extends dto(CreateInviteSchema) {}

export class UpdateInviteDto extends dto(UpdateInviteInputSchema) {}

// ── Channel ─────────────────────────────────────────────────────────

const CreateChannelSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(['text', 'voice', 'direct', 'group']).optional(),
	category_id: z.string().optional()
});
export class CreateChannelDto extends dto(CreateChannelSchema) {}

// `topic` and `category_id` only allow undefined here; the channel
// service's update path uses the keys' presence (not null) to mean
// "explicit clear" — callers send `topic: ''` or omit the key entirely.
const UpdateChannelSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	topic: z.string().max(1024).optional(),
	category_id: z.string().nullable().optional()
});
export class UpdateChannelDto extends dto(UpdateChannelSchema) {}

export class ChannelReorderDto extends dto(ChannelReorderInputSchema) {}

const CreateDmSchema = z.object({
	recipient_id: z.string().min(1),
	syr_instance_url: z.string().url().optional()
});
export class CreateDmDto extends dto(CreateDmSchema) {}

// ── Category ────────────────────────────────────────────────────────

const CreateCategorySchema = z.object({
	name: z.string().min(1).max(100)
});
export class CreateCategoryDto extends dto(CreateCategorySchema) {}

const UpdateCategorySchema = z.object({
	name: z.string().min(1).max(100).optional()
});
export class UpdateCategoryDto extends dto(UpdateCategorySchema) {}

const CategoryReorderSchema = z.object({
	categoryIds: z.array(z.string().min(1)).min(2)
});
export class CategoryReorderDto extends dto(CategoryReorderSchema) {}

// ── Member / moderation ─────────────────────────────────────────────

export class BanMemberDto extends dto(BanMemberInputSchema) {}
export class PurgeMessagesDto extends dto(PurgeMessagesInputSchema) {}

const MarkChannelReadSchema = z.object({
	last_message_id: z.string().min(1)
});
export class MarkChannelReadDto extends dto(MarkChannelReadSchema) {}

// ── Message ─────────────────────────────────────────────────────────

// Hand-written rather than reusing `SendMessageInputSchema` because the
// existing controller accepts `reply_to` as a single string OR an array
// for backwards-compat; the Rust struct only models the array form.
const SendMessageSchema = z.object({
	content: z.string().max(4000).optional(),
	reply_to: z.union([z.string(), z.array(z.string())]).optional(),
	attachments: z
		.array(
			z.object({
				url: z.string().url(),
				filename: z.string().min(1),
				mime_type: z.string().min(1),
				size: z.number().int().min(0),
				width: z.number().int().min(0).optional(),
				height: z.number().int().min(0).optional()
			})
		)
		.max(10)
		.optional()
});
export class SendMessageDto extends dto(SendMessageSchema) {}

const EditMessageSchema = z.object({
	content: z.string().min(1).max(4000)
});
export class EditMessageDto extends dto(EditMessageSchema) {}

const AddReactionSchema = z.object({
	kind: z.string().min(1),
	value: z.string().min(1),
	image_url: z.string().url().optional()
});
export class AddReactionDto extends dto(AddReactionSchema) {}

const RemoveReactionSchema = z.object({
	value: z.string().min(1)
});
export class RemoveReactionDto extends dto(RemoveReactionSchema) {}

const PinMessageSchema = z.object({
	message_id: z.string().min(1)
});
export class PinMessageDto extends dto(PinMessageSchema) {}

// ── Permission overrides ────────────────────────────────────────────

export class UpsertOverrideDto extends dto(UpsertOverrideInputSchema) {}

// ── Relations ───────────────────────────────────────────────────────

const FriendSendSchema = z.object({
	user_id: z.string().min(1),
	syr_instance_url: z.string().url().optional()
});
export class FriendSendDto extends dto(FriendSendSchema) {}

const SingleUserIdSchema = z.object({
	user_id: z.string().min(1)
});
export class BlockUserDto extends dto(SingleUserIdSchema) {}
export class IgnoreUserDto extends dto(SingleUserIdSchema) {}

// ── Roles ───────────────────────────────────────────────────────────

const CreateRoleSchema = z.object({
	name: z.string().min(1).max(100),
	color: z.string().max(32).nullable().optional(),
	permissions: z.string().optional(),
	permissions_allow: z.string().optional(),
	permissions_deny: z.string().optional()
});
export class CreateRoleDto extends dto(CreateRoleSchema) {}

const UpdateRoleSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	color: z.string().max(32).nullable().optional(),
	permissions: z.string().optional(),
	permissions_allow: z.string().optional(),
	permissions_deny: z.string().optional(),
	position: z.number().int().min(0).optional()
});
export class UpdateRoleDto extends dto(UpdateRoleSchema) {}

const RoleReorderSchema = z.object({
	roleIds: z.array(z.string().min(1)).min(2)
});
export class RoleReorderDto extends dto(RoleReorderSchema) {}

// ── Uploads ─────────────────────────────────────────────────────────

// Hand-written to drop `.nullable()` on optional fields (see CreateInviteDto).
const UploadPresignSchema = z.object({
	filename: z.string().min(1).max(255),
	mime_type: z.string().min(1),
	size: z.number().int().min(0),
	channel_id: z.string().optional(),
	sha256: z.string().optional()
});
export class UploadPresignDto extends dto(UploadPresignSchema) {}

const UploadFinalizeSchema = z.object({
	sha256: z.string().optional(),
	width: z.number().int().min(0).optional(),
	height: z.number().int().min(0).optional()
});
export class UploadFinalizeDto extends dto(UploadFinalizeSchema) {}

// ── User ────────────────────────────────────────────────────────────

// Hand-written rather than reusing `UpdateMyselfInputSchema` from
// `@syren/types`: the Rust source covers profile fields (display_name,
// bio, avatar_url) but the API's user-controller exposes only the
// privacy / trust controls. The runtime body is a strict subset.
const UpdateMyselfSchema = z.object({
	trusted_domains: z.array(z.string().min(1)).max(200).optional(),
	allow_dms: z.enum(['open', 'friends_only', 'closed']).optional(),
	allow_friend_requests: z.enum(['open', 'mutual', 'closed']).optional()
});
export class UpdateMyselfDto extends dto(UpdateMyselfSchema) {}

// ── Voice ───────────────────────────────────────────────────────────

const VoiceTokenSchema = z.object({
	channel_id: z.string().min(1)
});
export class VoiceTokenDto extends dto(VoiceTokenSchema) {}
