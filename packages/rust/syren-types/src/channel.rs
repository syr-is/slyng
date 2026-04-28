//! Channels (text, voice, DM, group DM) and DM-channel summaries.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum ChannelType {
	#[serde(rename = "text")]
	Text,
	#[serde(rename = "voice")]
	Voice,
	#[serde(rename = "direct")]
	Direct,
	#[serde(rename = "group")]
	Group,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Channel {
	pub id: String,
	#[serde(rename = "type")]
	pub channel_type: ChannelType,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub topic: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub server_id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub category_id: Option<String>,
	#[serde(default)]
	pub position: u32,
	pub created_by: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub last_message_at: Option<String>,
	#[serde(default)]
	pub deleted: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_at: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_by: Option<String>,
	pub created_at: String,
	pub updated_at: String,
	/// API may attach the caller's effective per-channel permissions.
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub my_permissions: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum ParticipantRole {
	#[serde(rename = "owner")]
	Owner,
	#[serde(rename = "admin")]
	Admin,
	#[serde(rename = "member")]
	Member,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ChannelParticipant {
	pub id: String,
	pub channel_id: String,
	pub user_id: String,
	#[serde(default = "default_participant_role")]
	pub role: ParticipantRole,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub last_read_at: Option<String>,
	pub joined_at: String,
	pub created_at: String,
	pub updated_at: String,
}

fn default_participant_role() -> ParticipantRole {
	ParticipantRole::Member
}

/// Summary row shown in the DM list (`GET /api/users/@me/channels`).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct DmChannelSummary {
	pub id: String,
	#[serde(rename = "type")]
	pub channel_type: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub last_message_at: Option<String>,
	#[serde(default)]
	pub other_user_id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub other_user_instance_url: Option<String>,
	#[serde(default)]
	pub is_blocked: bool,
	#[serde(default)]
	pub is_ignored: bool,
}

/// Body for `POST /api/servers/:id/channels/reorder`. Lives here because
/// it's reorder-shaped, not part of any one channel record.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ChannelReorderInput {
	#[serde(rename = "channelIds")]
	pub channel_ids: Vec<String>,
	#[serde(rename = "categoryId", skip_serializing_if = "Option::is_none", default)]
	pub category_id: Option<String>,
}

// ── Channel input shapes ────────────────────────────────────────────

/// Body for `POST /api/servers/:serverId/channels`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateChannelInput {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none", default, rename = "type")]
	pub channel_type: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub category_id: Option<String>,
}

/// Body for `PATCH /api/channels/:id`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateChannelInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub topic: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub category_id: Option<String>,
}

/// Body for `POST /api/users/@me/channels` (open a DM).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateDmInput {
	pub recipient_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub syr_instance_url: Option<String>,
}

/// Body for `POST /api/users/@me/channels/:channelId/read`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MarkChannelReadInput {
	pub last_message_id: String,
}

/// Body for `POST /api/servers/:serverId/categories`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateCategoryInput {
	pub name: String,
}

/// Body for `PATCH /api/categories/:id`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateCategoryInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub name: Option<String>,
}

/// Body for `POST /api/servers/:serverId/categories/reorder`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CategoryReorderInput {
	#[serde(rename = "categoryIds")]
	pub category_ids: Vec<String>,
}
