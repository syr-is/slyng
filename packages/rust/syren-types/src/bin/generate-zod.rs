//! Emit a single TypeScript file containing every Zod schema + inferred
//! type for the API entities defined in `syren-types`.
//!
//! Run via:
//!
//! ```bash
//! cargo run -p syren-types --bin generate-zod -- packages/ts/types/src/generated.ts
//! ```
//!
//! `@syren/types`'s build script invokes this in CI so the .ts file
//! tracks the Rust source whenever a struct gains/loses a field.

use std::env;
use std::fs;
use std::process::ExitCode;

use syren_types::*;
use zod_gen::ZodGenerator;

fn main() -> ExitCode {
	let out_path = match env::args().nth(1) {
		Some(p) => p,
		None => {
			eprintln!("usage: generate-zod <out-path>");
			return ExitCode::from(1);
		}
	};

	let mut g = ZodGenerator::new();

	// Auth
	g.add_schema::<LoginRequest>("LoginRequest");
	g.add_schema::<LoginResponse>("LoginResponse");
	g.add_schema::<ExchangeRequest>("ExchangeRequest");
	g.add_schema::<ExchangeResponse>("ExchangeResponse");
	g.add_schema::<Identity>("Identity");

	// Common
	g.add_schema::<SuccessResponse>("SuccessResponse");
	g.add_schema::<TransferOwnershipResponse>("TransferOwnershipResponse");
	g.add_schema::<InviteJoinResponse>("InviteJoinResponse");
	g.add_schema::<CreateDmResponse>("CreateDmResponse");
	g.add_schema::<CreateInviteResponse>("CreateInviteResponse");

	// Server / member / role / invite / ban / category
	g.add_schema::<Server>("Server");
	g.add_schema::<ServerMember>("ServerMember");
	g.add_schema::<ServerRole>("ServerRole");
	g.add_schema::<ServerInvite>("ServerInvite");
	g.add_schema::<ServerBan>("ServerBan");
	g.add_schema::<ChannelCategory>("ChannelCategory");
	g.add_schema::<InviteTargetKind>("InviteTargetKind");

	// Channel
	g.add_schema::<Channel>("Channel");
	g.add_schema::<ChannelType>("ChannelType");
	g.add_schema::<ChannelParticipant>("ChannelParticipant");
	g.add_schema::<ParticipantRole>("ParticipantRole");
	g.add_schema::<DmChannelSummary>("DmChannelSummary");
	g.add_schema::<ChannelReorderInput>("ChannelReorderInput");

	// Message
	g.add_schema::<Message>("Message");
	g.add_schema::<MessageType>("MessageType");
	g.add_schema::<Attachment>("Attachment");
	g.add_schema::<Embed>("Embed");
	g.add_schema::<ReactionSummary>("ReactionSummary");
	g.add_schema::<SendMessageInput>("SendMessageInput");

	// User / resolve
	g.add_schema::<User>("User");
	g.add_schema::<UserResolveResult>("UserResolveResult");
	g.add_schema::<UpdateMyselfInput>("UpdateMyselfInput");

	// Relation
	g.add_schema::<FriendshipStatus>("FriendshipStatus");
	g.add_schema::<Friendship>("Friendship");
	g.add_schema::<UserBlock>("UserBlock");
	g.add_schema::<UserIgnore>("UserIgnore");
	g.add_schema::<AllowDms>("AllowDms");
	g.add_schema::<AllowFriendRequests>("AllowFriendRequests");
	g.add_schema::<RelationsSnapshot>("RelationsSnapshot");
	g.add_schema::<PendingFriendRequest>("PendingFriendRequest");
	g.add_schema::<FriendshipRow>("FriendshipRow");
	g.add_schema::<BlockedRow>("BlockedRow");
	g.add_schema::<IgnoredRow>("IgnoredRow");

	// Permission
	g.add_schema::<PermissionScopeType>("PermissionScopeType");
	g.add_schema::<PermissionTargetType>("PermissionTargetType");
	g.add_schema::<PermissionOverride>("PermissionOverride");
	g.add_schema::<UpsertOverrideInput>("UpsertOverrideInput");
	g.add_schema::<MyPermissions>("MyPermissions");
	g.add_schema::<MemberPermissionsView>("MemberPermissionsView");
	g.add_schema::<VisibleChannelSummary>("VisibleChannelSummary");
	g.add_schema::<PermissionTree>("PermissionTree");
	g.add_schema::<PermissionTreeServer>("PermissionTreeServer");
	g.add_schema::<PermissionTreeCategory>("PermissionTreeCategory");
	g.add_schema::<PermissionTreeChannel>("PermissionTreeChannel");

	// Audit
	g.add_schema::<AuditAction>("AuditAction");
	g.add_schema::<AuditTargetKind>("AuditTargetKind");
	g.add_schema::<AuditLog>("AuditLog");

	// Invite
	g.add_schema::<InvitePreview>("InvitePreview");
	g.add_schema::<InvitePreviewServer>("InvitePreviewServer");
	g.add_schema::<CreateInviteInput>("CreateInviteInput");
	g.add_schema::<UpdateInviteInput>("UpdateInviteInput");

	// Voice
	g.add_schema::<VoiceTokenResponse>("VoiceTokenResponse");
	g.add_schema::<VoiceState>("VoiceState");

	// Upload
	g.add_schema::<UploadPresignInput>("UploadPresignInput");
	g.add_schema::<UploadPresignResponse>("UploadPresignResponse");
	g.add_schema::<UploadFinalizeInput>("UploadFinalizeInput");
	g.add_schema::<UploadFinalizeResponse>("UploadFinalizeResponse");

	// Trash
	g.add_schema::<TrashChannelEntry>("TrashChannelEntry");
	g.add_schema::<TrashRoleEntry>("TrashRoleEntry");
	g.add_schema::<TrashMessageEntry>("TrashMessageEntry");

	// Member moderation
	g.add_schema::<MemberMessageEntry>("MemberMessageEntry");
	g.add_schema::<MemberMessageStats>("MemberMessageStats");
	g.add_schema::<MemberMessagePerChannel>("MemberMessagePerChannel");
	g.add_schema::<PurgeMessagesInput>("PurgeMessagesInput");
	g.add_schema::<KickMemberQuery>("KickMemberQuery");
	g.add_schema::<BanMemberInput>("BanMemberInput");

	// Presence + reaction
	g.add_schema::<PresenceStatus>("PresenceStatus");
	g.add_schema::<Presence>("Presence");
	g.add_schema::<ReactionKind>("ReactionKind");
	g.add_schema::<MessageReaction>("MessageReaction");

	// Pagination wrappers
	g.add_schema::<PaginatedQuery>("PaginatedQuery");
	g.add_schema::<PageServerMember>("PageServerMember");
	g.add_schema::<PageServerBan>("PageServerBan");
	g.add_schema::<PageServerInvite>("PageServerInvite");
	g.add_schema::<PageAuditLog>("PageAuditLog");
	g.add_schema::<PageMemberMessageEntry>("PageMemberMessageEntry");
	g.add_schema::<PageTrashMessageEntry>("PageTrashMessageEntry");
	g.add_schema::<PageFriendshipRow>("PageFriendshipRow");
	g.add_schema::<PageBlockedRow>("PageBlockedRow");
	g.add_schema::<PageIgnoredRow>("PageIgnoredRow");

	// WS payloads
	g.add_schema::<WsEnvelope>("WsEnvelope");
	g.add_schema::<WsIdentifyPayload>("WsIdentifyPayload");
	g.add_schema::<WsSubscribePayload>("WsSubscribePayload");
	g.add_schema::<WsTypingStartPayload>("WsTypingStartPayload");
	g.add_schema::<WsPresenceUpdatePayload>("WsPresenceUpdatePayload");
	g.add_schema::<WsVoiceStateUpdatePayload>("WsVoiceStateUpdatePayload");
	g.add_schema::<WsReadyPayload>("WsReadyPayload");
	g.add_schema::<WsReadyServer>("WsReadyServer");
	g.add_schema::<WsReadyChannel>("WsReadyChannel");
	g.add_schema::<WsReadyDmChannel>("WsReadyDmChannel");
	g.add_schema::<WsReadyPresence>("WsReadyPresence");
	g.add_schema::<WsReadyUnread>("WsReadyUnread");
	g.add_schema::<WsTypingStartBroadcastPayload>("WsTypingStartBroadcastPayload");
	g.add_schema::<WsPresenceUpdateBroadcastPayload>("WsPresenceUpdateBroadcastPayload");
	g.add_schema::<WsMessageDeletePayload>("WsMessageDeletePayload");
	g.add_schema::<WsChannelDeletePayload>("WsChannelDeletePayload");
	g.add_schema::<WsMemberRemovePayload>("WsMemberRemovePayload");
	g.add_schema::<WsRoleDeletePayload>("WsRoleDeletePayload");
	g.add_schema::<WsServerDeletePayload>("WsServerDeletePayload");
	g.add_schema::<WsReactionPayload>("WsReactionPayload");
	g.add_schema::<WsPinPayload>("WsPinPayload");
	g.add_schema::<WsCategoryDeletePayload>("WsCategoryDeletePayload");
	g.add_schema::<WsWatchProfilesPayload>("WsWatchProfilesPayload");
	g.add_schema::<WsWatchProfileEntry>("WsWatchProfileEntry");
	g.add_schema::<WsUnwatchProfilesPayload>("WsUnwatchProfilesPayload");
	g.add_schema::<WsProfileUpdatePayload>("WsProfileUpdatePayload");
	g.add_schema::<WsFriendRequestReceivePayload>("WsFriendRequestReceivePayload");
	g.add_schema::<WsFriendRequestUpdatePayload>("WsFriendRequestUpdatePayload");
	g.add_schema::<WsBlockUpdatePayload>("WsBlockUpdatePayload");
	g.add_schema::<WsIgnoreUpdatePayload>("WsIgnoreUpdatePayload");
	g.add_schema::<WsDmPolicyUpdatePayload>("WsDmPolicyUpdatePayload");

	let body = g.generate();
	if let Err(err) = fs::write(&out_path, body) {
		eprintln!("failed to write {out_path}: {err}");
		return ExitCode::from(2);
	}

	eprintln!("wrote {out_path}");
	ExitCode::SUCCESS
}
