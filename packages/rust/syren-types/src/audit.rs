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
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
	MessageDelete,
	MessagePurge,
	MemberKick,
	MemberBan,
	MemberUnban,
	MemberRoleAdd,
	MemberRoleRemove,
	RoleCreate,
	RoleUpdate,
	RoleDelete,
	ChannelCreate,
	ChannelUpdate,
	ChannelDelete,
	ChannelRestore,
	ChannelHardDelete,
	RoleRestore,
	RoleHardDelete,
	MessageRestore,
	MessageHardDelete,
	ServerUpdate,
	ServerTransferOwnership,
	InviteCreate,
	InviteUpdate,
	InviteDelete,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "snake_case")]
pub enum AuditTargetKind {
	Message,
	Member,
	Role,
	Channel,
	Server,
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
