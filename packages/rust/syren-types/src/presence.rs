//! Presence (online status) shapes.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "snake_case")]
pub enum PresenceStatus {
	Online,
	Idle,
	Dnd,
	Invisible,
	Offline,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Presence {
	pub user_id: String,
	pub status: PresenceStatus,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub last_seen_at: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_status: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_emoji: Option<String>,
}
