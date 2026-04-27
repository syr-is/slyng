//! Soft-delete browser shapes for the moderation "trash" tabs.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TrashChannelEntry {
	pub id: String,
	pub name: String,
	#[serde(rename = "type")]
	pub channel_type: String,
	pub deleted_at: String,
	pub deleted_by: String,
	pub message_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TrashRoleEntry {
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub color: Option<String>,
	pub deleted_at: String,
	pub deleted_by: String,
	pub member_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TrashMessageEntry {
	pub id: String,
	pub channel_id: String,
	#[serde(default)]
	pub channel_name: Option<String>,
	pub sender_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub sender_instance_url: Option<String>,
	pub content: String,
	#[serde(default)]
	pub attachments: Vec<crate::message::Attachment>,
	pub created_at: String,
	pub deleted_at: String,
	pub deleted_by: String,
}
