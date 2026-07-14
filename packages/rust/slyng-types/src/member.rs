//! Per-member moderation views: message listings + aggregate stats.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// Row in `Page<MemberMessageEntry>` for the moderation "member messages"
/// table.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MemberMessageEntry {
	pub id: String,
	pub channel_id: String,
	#[serde(default)]
	pub channel_name: Option<String>,
	pub sender_id: String,
	pub content: String,
	pub created_at: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub edited_at: Option<String>,
	#[serde(default)]
	pub attachments: Vec<crate::message::Attachment>,
}

/// `GET /api/servers/:id/members/:userId/message-stats` reply.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MemberMessageStats {
	pub total: u64,
	#[serde(default)]
	pub first_at: Option<String>,
	#[serde(default)]
	pub last_at: Option<String>,
	#[serde(default)]
	pub per_channel: Vec<MemberMessagePerChannel>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MemberMessagePerChannel {
	pub channel_id: String,
	#[serde(default)]
	pub channel_name: Option<String>,
	pub count: u64,
}

/// Body for `POST /api/servers/:id/members/:userId/messages/purge`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PurgeMessagesInput {
	pub delete_seconds: u64,
}

/// Query for `DELETE /api/servers/:id/members/:userId` (kick).
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct KickMemberQuery {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub delete_seconds: Option<u64>,
}

/// Body for `POST /api/servers/:id/bans` (ban).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BanMemberInput {
	pub user_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub reason: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub delete_seconds: Option<u64>,
}
