//! Audit log entries.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum AuditAction {
	#[serde(rename = "message_delete")]
	MessageDelete,
	#[serde(rename = "message_purge")]
	MessagePurge,
	#[serde(rename = "member_kick")]
	MemberKick,
	#[serde(rename = "member_ban")]
	MemberBan,
	#[serde(rename = "member_unban")]
	MemberUnban,
	#[serde(rename = "member_role_add")]
	MemberRoleAdd,
	#[serde(rename = "member_role_remove")]
	MemberRoleRemove,
	#[serde(rename = "role_create")]
	RoleCreate,
	#[serde(rename = "role_update")]
	RoleUpdate,
	#[serde(rename = "role_delete")]
	RoleDelete,
	#[serde(rename = "channel_create")]
	ChannelCreate,
	#[serde(rename = "channel_update")]
	ChannelUpdate,
	#[serde(rename = "channel_delete")]
	ChannelDelete,
	#[serde(rename = "channel_restore")]
	ChannelRestore,
	#[serde(rename = "channel_hard_delete")]
	ChannelHardDelete,
	#[serde(rename = "role_restore")]
	RoleRestore,
	#[serde(rename = "role_hard_delete")]
	RoleHardDelete,
	#[serde(rename = "message_restore")]
	MessageRestore,
	#[serde(rename = "message_hard_delete")]
	MessageHardDelete,
	#[serde(rename = "server_update")]
	ServerUpdate,
	#[serde(rename = "server_transfer_ownership")]
	ServerTransferOwnership,
	#[serde(rename = "invite_create")]
	InviteCreate,
	#[serde(rename = "invite_update")]
	InviteUpdate,
	#[serde(rename = "invite_delete")]
	InviteDelete,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum AuditTargetKind {
	#[serde(rename = "message")]
	Message,
	#[serde(rename = "member")]
	Member,
	#[serde(rename = "role")]
	Role,
	#[serde(rename = "channel")]
	Channel,
	#[serde(rename = "server")]
	Server,
	#[serde(rename = "invite")]
	Invite,
}

/// Free-form metadata on each audit entry. The API attaches whatever
/// extra fields are useful for the UI label (counts, names, before /
/// after diffs). We carry it as a serde_json map so consumers can read
/// per-action keys without us re-modelling each variant.
pub type AuditMetadata = HashMap<String, JsonValue>;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct AuditLog {
	pub id: String,
	pub server_id: String,
	pub actor_id: String,
	pub action: AuditAction,
	pub target_kind: AuditTargetKind,
	#[serde(default)]
	pub target_id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub target_user_id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub channel_id: Option<String>,
	#[serde(default)]
	pub metadata: AuditMetadata,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub reason: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub batch_id: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}
