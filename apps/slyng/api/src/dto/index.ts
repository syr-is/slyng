/**
 * Input DTOs for every controller `@Body()`. Each one is a
 * `createZodDto(schema)` class — the global `ZodValidationPipe`
 * (registered in `app.module.ts`) parses + rejects malformed bodies
 * before the handler runs.
 *
 * Schemas live in `@slyng/types/generated.ts`, which is itself
 * regenerated from `packages/rust/slyng-types/`'s Rust structs via
 * `pnpm --filter @slyng/types gen`. The Rust source is the canonical
 * shape — to add or change a body, edit the Rust struct and regenerate.
 *
 * Why the `dto()` helper exists: nestjs-zod v5 ties its DTO instance
 * type to `ReturnType<TSchema['parse']>` against an `UnknownSchema`
 * constraint whose `parse` returns `unknown`. Under Zod 4's
 * `this`-typed parse signature that collapses to `unknown`, so
 * `class FooDto extends createZodDto(FooSchema) {}` ends up with no
 * accessible properties on the instance. The wrapper casts the
 * returned constructor to `new () => z.infer<S>` so `extends
 * dto(schema)` preserves the schema's shape on the class instance.
 * Runtime metadata (`isZodDto`, `.schema`) is unchanged; only the
 * static typing is corrected.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
	AddReactionInputSchema,
	BanMemberInputSchema,
	CategoryReorderInputSchema,
	ChannelReorderInputSchema,
	CreateCategoryInputSchema,
	CreateChannelInputSchema,
	CreateDmInputSchema,
	CreateInviteInputSchema,
	CreateRoleInputSchema,
	CreateServerInputSchema,
	EditMessageInputSchema,
	ExchangeRequestSchema,
	FriendSendInputSchema,
	LocalLoginRequestSchema,
	LocalProfilePatchSchema,
	LocalRegisterRequestSchema,
	LoginRequestSchema,
	FullProfilePatchSchema,
	ProfileAssetPresignSchema,
	PostCreateSchema,
	PostUpdateSchema,
	PostAssetPresignSchema,
	EmojiPresignSchema,
	EmojiCompleteSchema,
	GifPresignSchema,
	GifCompleteSchema,
	FolderCreateSchema,
	FolderUpdateSchema,
	LibraryPresignSchema,
	UploadPatchSchema,
	ShareLinkRequestSchema,
	InstanceLimitsPatchSchema,
	CommentCreateSchema,
	CommentUpdateSchema,
	ReactionCreateSchema,
	FollowCreateSchema,
	FollowVisibilitySchema,
	RegistryAddSchema,
	RegistrySyncSchema,
	DelegationVerifyRequestSchema,
	IndependentLoginChallengeRequestSchema,
	IndependentLoginVerifyRequestSchema,
	IdentityExportRequestSchema,
	RegisterWithImportSchema,
	UploadCreateSchema,
	UploadCompleteSchema,
	PlatformChallengeRequestSchema,
	PlatformConsentApproveSchema,
	PlatformConsentDirectSchema,
	PlatformRegistrationRequestSchema,
	PlatformRevokeRequestSchema,
	PlatformSignRequestSchema,
	PlatformTokenRequestSchema,
	MarkChannelReadInputSchema,
	PinMessageInputSchema,
	PurgeMessagesInputSchema,
	RemoveReactionInputSchema,
	RoleReorderInputSchema,
	TransferOwnershipInputSchema,
	UpdateCategoryInputSchema,
	UpdateChannelInputSchema,
	UpdateInviteInputSchema,
	UpdateMyselfPolicyInputSchema,
	UpdateRoleInputSchema,
	UpdateServerInputSchema,
	UploadFinalizeInputSchema,
	UploadPresignInputSchema,
	UpsertOverrideInputSchema,
	UserIdInputSchema,
	VoiceTokenInputSchema
} from '@slyng/types';

function dto<S extends z.ZodTypeAny>(schema: S): new () => z.infer<S> {
	return createZodDto(schema as never) as unknown as new () => z.infer<S>;
}

// ── Auth ────────────────────────────────────────────────────────────

export class LoginDto extends dto(LoginRequestSchema) {}
export class ExchangeDto extends dto(ExchangeRequestSchema) {}
export class LocalRegisterDto extends dto(LocalRegisterRequestSchema) {}
export class LocalLoginDto extends dto(LocalLoginRequestSchema) {}
export class LocalProfilePatchDto extends dto(LocalProfilePatchSchema) {}

// ── Local profile hosting + stories (IdP) ───────────────────────────

export class FullProfilePatchDto extends dto(FullProfilePatchSchema) {}
export class ProfileAssetPresignDto extends dto(ProfileAssetPresignSchema) {}
export class StoryPresignDto extends dto(UploadCreateSchema) {}
export class StoryCompleteDto extends dto(UploadCompleteSchema) {}

// ── Posts (IdP) ─────────────────────────────────────────────────────

export class PostCreateDto extends dto(PostCreateSchema) {}
export class PostUpdateDto extends dto(PostUpdateSchema) {}
export class PostAssetPresignDto extends dto(PostAssetPresignSchema) {}
export class EmojiPresignDto extends dto(EmojiPresignSchema) {}
export class EmojiCompleteDto extends dto(EmojiCompleteSchema) {}
export class GifPresignDto extends dto(GifPresignSchema) {}
export class GifCompleteDto extends dto(GifCompleteSchema) {}

// ── IdP library (P7) ────────────────────────────────────────────────
export class FolderCreateDto extends dto(FolderCreateSchema) {}
export class FolderUpdateDto extends dto(FolderUpdateSchema) {}
export class LibraryPresignDto extends dto(LibraryPresignSchema) {}
export class LibraryCompleteDto extends dto(UploadCompleteSchema) {}
export class UploadPatchDto extends dto(UploadPatchSchema) {}
export class ShareLinkDto extends dto(ShareLinkRequestSchema) {}
export class InstanceLimitsPatchDto extends dto(InstanceLimitsPatchSchema) {}

// ── Comments / reactions / follows (P8) ─────────────────────────────
export class CommentCreateDto extends dto(CommentCreateSchema) {}
export class CommentUpdateDto extends dto(CommentUpdateSchema) {}
export class ReactionCreateDto extends dto(ReactionCreateSchema) {}
export class FollowCreateDto extends dto(FollowCreateSchema) {}
export class FollowVisibilityDto extends dto(FollowVisibilitySchema) {}

// ── Registry / outbox (P9) ──────────────────────────────────────────
export class RegistryAddDto extends dto(RegistryAddSchema) {}
export class RegistrySyncDto extends dto(RegistrySyncSchema) {}

// ── Platform delegation (IdP server side) ───────────────────────────

export class PlatformRegisterDto extends dto(PlatformRegistrationRequestSchema) {}
export class PlatformTokenDto extends dto(PlatformTokenRequestSchema) {}
export class PlatformSignDto extends dto(PlatformSignRequestSchema) {}
export class PlatformChallengeDto extends dto(PlatformChallengeRequestSchema) {}
export class PlatformRevokeDto extends dto(PlatformRevokeRequestSchema) {}
export class PlatformConsentDirectDto extends dto(PlatformConsentDirectSchema) {}
export class PlatformConsentApproveDto extends dto(PlatformConsentApproveSchema) {}

// ── Syner self-custody (P10) ────────────────────────────────────────
export class DelegationVerifyDto extends dto(DelegationVerifyRequestSchema) {}
export class IndependentLoginChallengeDto extends dto(IndependentLoginChallengeRequestSchema) {}
export class IndependentLoginVerifyDto extends dto(IndependentLoginVerifyRequestSchema) {}

// ── Identity import / export (P11) ──────────────────────────────────
export class IdentityExportDto extends dto(IdentityExportRequestSchema) {}
export class RegisterWithImportDto extends dto(RegisterWithImportSchema) {}

// ── Server ──────────────────────────────────────────────────────────

export class CreateServerDto extends dto(CreateServerInputSchema) {}
export class UpdateServerDto extends dto(UpdateServerInputSchema) {}
export class TransferOwnershipDto extends dto(TransferOwnershipInputSchema) {}
export class CreateInviteDto extends dto(CreateInviteInputSchema) {}
export class UpdateInviteDto extends dto(UpdateInviteInputSchema) {}

// ── Channel ─────────────────────────────────────────────────────────

export class CreateChannelDto extends dto(CreateChannelInputSchema) {}
export class UpdateChannelDto extends dto(UpdateChannelInputSchema) {}
export class ChannelReorderDto extends dto(ChannelReorderInputSchema) {}
export class CreateDmDto extends dto(CreateDmInputSchema) {}

// ── Category ────────────────────────────────────────────────────────

export class CreateCategoryDto extends dto(CreateCategoryInputSchema) {}
export class UpdateCategoryDto extends dto(UpdateCategoryInputSchema) {}
export class CategoryReorderDto extends dto(CategoryReorderInputSchema) {}

// ── Member / moderation ─────────────────────────────────────────────

export class BanMemberDto extends dto(BanMemberInputSchema) {}
export class PurgeMessagesDto extends dto(PurgeMessagesInputSchema) {}
export class MarkChannelReadDto extends dto(MarkChannelReadInputSchema) {}

// ── Message ─────────────────────────────────────────────────────────

// Hand-written rather than reusing `SendMessageInputSchema` from the
// Rust source: the existing controller accepts `reply_to` as a single
// string OR an array (legacy compat). The Rust struct only models the
// array form, so we can't generate a schema with the union.
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

export class EditMessageDto extends dto(EditMessageInputSchema) {}
export class AddReactionDto extends dto(AddReactionInputSchema) {}
export class RemoveReactionDto extends dto(RemoveReactionInputSchema) {}
export class PinMessageDto extends dto(PinMessageInputSchema) {}

// ── Permission overrides ────────────────────────────────────────────

export class UpsertOverrideDto extends dto(UpsertOverrideInputSchema) {}

// ── Relations ───────────────────────────────────────────────────────

export class FriendSendDto extends dto(FriendSendInputSchema) {}
export class BlockUserDto extends dto(UserIdInputSchema) {}
export class IgnoreUserDto extends dto(UserIdInputSchema) {}

// ── Roles ───────────────────────────────────────────────────────────

export class CreateRoleDto extends dto(CreateRoleInputSchema) {}
export class UpdateRoleDto extends dto(UpdateRoleInputSchema) {}
export class RoleReorderDto extends dto(RoleReorderInputSchema) {}

// ── Uploads ─────────────────────────────────────────────────────────

export class UploadPresignDto extends dto(UploadPresignInputSchema) {}
export class UploadFinalizeDto extends dto(UploadFinalizeInputSchema) {}

// ── User ────────────────────────────────────────────────────────────

export class UpdateMyselfDto extends dto(UpdateMyselfPolicyInputSchema) {}

// ── Voice ───────────────────────────────────────────────────────────

export class VoiceTokenDto extends dto(VoiceTokenInputSchema) {}
