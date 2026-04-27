//! Invite preview shape returned by `GET /api/invites/:code/preview`.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct InvitePreview {
	pub code: String,
	#[serde(default)]
	pub target_kind: crate::server::InviteTargetKind,
	#[serde(default)]
	pub target_value: Option<String>,
	#[serde(default)]
	pub label: Option<String>,
	pub server: InvitePreviewServer,
}

/// Compressed server profile shown on the invite landing page (no
/// owner / role data, just enough for the join UI).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct InvitePreviewServer {
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub icon_url: Option<String>,
	#[serde(default)]
	pub banner_url: Option<String>,
	#[serde(default)]
	pub invite_background_url: Option<String>,
	#[serde(default)]
	pub description: Option<String>,
	#[serde(default)]
	pub member_count: u32,
}

/// Body for `POST /api/servers/:id/invites`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateInviteInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub max_uses: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub expires_in: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub target_kind: Option<crate::server::InviteTargetKind>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub target_value: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub label: Option<String>,
}

/// Body for `PATCH /api/servers/:id/invites/:code`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateInviteInput {
	#[serde(default)]
	pub label: Option<String>,
}
