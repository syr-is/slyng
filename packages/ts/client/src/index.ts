/**
 * `@syren/client` — typed namespace adapter over the wasm-pack-emitted
 * Rust client. Every entity / endpoint type is auto-derived from
 * `syren-types` (the source-of-truth Rust crate) via tsify-next.
 *
 * Usage:
 *
 *     import { initSyrenClient } from '@syren/client';
 *
 *     const client = await initSyrenClient('https://app.slyng.gg');
 *     await client.auth.login('https://app.syr.is');
 *     const me = await client.auth.me();
 *     const servers = await client.servers.list();
 *
 * Types are also re-exported here for convenience:
 *
 *     import type { Server, Channel, Message } from '@syren/client';
 *
 * The canonical source for any type is `@syren/client/wasm` (the
 * wasm-pack output). The re-exports below are a stable surface that
 * doesn't reach into `dist/wasm/web/`.
 */

export { initSyrenClient } from './adapter.js';
export type { SyrenClient } from './adapter.js';

// Auto-derived data types from the wasm-pack `.d.ts`. Adding more
// here is purely a convenience — every type is reachable via
// `@syren/client/wasm` regardless.
export type {
	AllowDms,
	AllowFriendRequests,
	Attachment,
	AuditAction,
	AuditLog,
	AuditTargetKind,
	BanMemberInput,
	BlockedRow,
	Channel,
	ChannelCategory,
	ChannelParticipant,
	ChannelReorderInput,
	ChannelType,
	CreateDmResponse,
	CreateInviteInput,
	CreateInviteResponse,
	DmChannelSummary,
	Embed,
	ExchangeRequest,
	ExchangeResponse,
	Friendship,
	FriendshipRow,
	FriendshipStatus,
	Identity,
	IgnoredRow,
	InvitePreview,
	InvitePreviewServer,
	InviteJoinResponse,
	InviteTargetKind,
	KickMemberQuery,
	LoginRequest,
	LoginResponse,
	MemberMessageEntry,
	MemberMessagePerChannel,
	MemberMessageStats,
	MemberPermissionsView,
	Message,
	MessageReaction,
	MessageType,
	MyPermissions,
	PageAuditLog,
	PageBlockedRow,
	PageFriendshipRow,
	PageIgnoredRow,
	PageMemberMessageEntry,
	PageServerBan,
	PageServerInvite,
	PageServerMember,
	PageTrashMessageEntry,
	PaginatedQuery,
	ParticipantRole,
	PendingFriendRequest,
	PermissionOverride,
	PermissionScopeType,
	PermissionTargetType,
	PermissionTree,
	PermissionTreeCategory,
	PermissionTreeChannel,
	PermissionTreeServer,
	Presence,
	PresenceStatus,
	PurgeMessagesInput,
	ReactionKind,
	ReactionSummary,
	RelationsSnapshot,
	SendMessageInput,
	Server,
	ServerBan,
	ServerInvite,
	ServerMember,
	ServerRole,
	SuccessResponse,
	TransferOwnershipResponse,
	TrashChannelEntry,
	TrashMessageEntry,
	TrashRoleEntry,
	UpdateInviteInput,
	UpdateMyselfInput,
	UploadFinalizeInput,
	UploadFinalizeResponse,
	UploadPresignInput,
	UploadPresignResponse,
	UpsertOverrideInput,
	User,
	UserBlock,
	UserIgnore,
	UserResolveResult,
	VisibleChannelSummary,
	VoiceState,
	VoiceTokenResponse,
} from './adapter.js';
