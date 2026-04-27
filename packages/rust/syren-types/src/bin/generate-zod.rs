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
//!
//! Two post-processing passes run on top of zod_gen's raw output:
//!
//! - `.nullable()` → `.nullable().optional()`. Rust `Option<T>` paired
//!   with `#[serde(skip_serializing_if = "Option::is_none", default)]`
//!   is sent over the wire as a missing key, *not* an explicit null.
//!   Zod's `.nullable()` alone rejects missing keys; chaining
//!   `.optional()` makes the schema accept missing, undefined, and null.
//! - `z.union([z.literal('a'), z.literal('b')])` → `z.enum(['a','b'])`
//!   when every member is a bare string literal. Consumers depend on
//!   `AuditActionSchema.options` (etc.) to enumerate values; that
//!   property exists on `z.enum` and not on `z.union`.

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
	let body = postprocess(&body);

	if let Err(err) = fs::write(&out_path, body) {
		eprintln!("failed to write {out_path}: {err}");
		return ExitCode::from(2);
	}

	eprintln!("wrote {out_path}");
	ExitCode::SUCCESS
}

fn postprocess(input: &str) -> String {
	let mut s = input.replace(".nullable()", ".nullable().optional()");
	s = unit_union_to_enum(&s);
	s
}

/// Replace `z.union([z.literal('a'), z.literal('b'), ...])` with
/// `z.enum(['a', 'b', ...])` whenever every member is a bare string
/// literal. Leaves non-unit unions (anything with a non-literal member,
/// like discriminated unions of objects) alone.
fn unit_union_to_enum(input: &str) -> String {
	const OPEN: &str = "z.union([";
	const CLOSE: &str = "])";

	let mut out = String::with_capacity(input.len());
	let mut rest = input;

	while let Some(start) = rest.find(OPEN) {
		out.push_str(&rest[..start]);
		let after_open = &rest[start + OPEN.len()..];

		// Find the matching `])` at bracket depth 0.
		let mut depth: i32 = 1;
		let mut close_idx: Option<usize> = None;
		for (i, b) in after_open.bytes().enumerate() {
			match b {
				b'[' => depth += 1,
				b']' => {
					depth -= 1;
					if depth == 0 {
						close_idx = Some(i);
						break;
					}
				}
				_ => {}
			}
		}
		let Some(end) = close_idx else {
			// Unbalanced — bail.
			out.push_str(&rest[start..]);
			return out;
		};

		// `])` only counts when the next char is `)`. zod_gen always
		// emits `z.union([...])` so the next byte should be `)` — but
		// guard for safety.
		let after_inner = &after_open[end..];
		if !after_inner.starts_with("])") {
			out.push_str(&rest[start..start + OPEN.len() + end + 1]);
			rest = &after_open[end + 1..];
			continue;
		}

		let inner = &after_open[..end];
		let parts: Vec<&str> = inner.split(", ").map(str::trim).collect();
		let mut literals: Vec<&str> = Vec::with_capacity(parts.len());
		let mut all_lit = !parts.is_empty();
		for part in &parts {
			let Some(rest_after_prefix) = part.strip_prefix("z.literal('") else {
				all_lit = false;
				break;
			};
			let Some(close_quote) = rest_after_prefix.find('\'') else {
				all_lit = false;
				break;
			};
			let after_quote = &rest_after_prefix[close_quote + 1..];
			if after_quote != ")" {
				all_lit = false;
				break;
			}
			literals.push(&rest_after_prefix[..close_quote]);
		}

		if all_lit {
			out.push_str("z.enum([");
			for (i, lit) in literals.iter().enumerate() {
				if i > 0 {
					out.push_str(", ");
				}
				out.push('\'');
				out.push_str(lit);
				out.push('\'');
			}
			out.push_str("])");
		} else {
			// Keep the union verbatim.
			out.push_str(&rest[start..start + OPEN.len() + end + CLOSE.len()]);
		}

		rest = &after_open[end + CLOSE.len()..];
	}

	out.push_str(rest);
	out
}
