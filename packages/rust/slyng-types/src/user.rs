//! User profile + identity-resolution shapes.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct User {
	pub id: String,
	pub syr_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub did: Option<String>,
	pub handle: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub display_name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub avatar_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub bio: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub syr_instance_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub delegate_public_key: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub last_seen_at: Option<String>,
	#[serde(default)]
	pub is_online: bool,
	#[serde(default)]
	pub has_instance: bool,
	#[serde(default)]
	pub allow_dms: crate::relation::AllowDms,
	#[serde(default)]
	pub allow_friend_requests: crate::relation::AllowFriendRequests,
	pub created_at: String,
	pub updated_at: String,
}

/// `GET /api/users/resolve?q=…` reply.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UserResolveResult {
	pub did: String,
	#[serde(default)]
	pub syr_instance_url: Option<String>,
	pub registered: bool,
}

/// Body for `PATCH /api/users/@me`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateMyselfInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub allow_dms: Option<crate::relation::AllowDms>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub allow_friend_requests: Option<crate::relation::AllowFriendRequests>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub display_name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub bio: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub avatar_url: Option<String>,
}
