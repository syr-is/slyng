//! Cross-cutting response shapes used by many endpoints.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// Generic `{ "success": true }` reply that a wide set of mutation
/// endpoints (kicks, deletes, reorders, pin/unpin, typing, …) produces
/// when they have nothing else useful to return.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct SuccessResponse {
	pub success: bool,
}

/// Server response for `POST /api/servers/:id/transfer-ownership`. Carries
/// the updated server record plus the role newly created for the outgoing
/// owner so the UI can highlight it.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TransferOwnershipResponse {
	pub server: crate::server::Server,
	pub former_owner_role_id: String,
}

/// `POST /api/invites/:code/join` reply.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct InviteJoinResponse {
	pub server_id: String,
}

/// `POST /api/users/@me/channels` reply (DM channel creation).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateDmResponse {
	pub id: String,
	#[serde(rename = "type")]
	pub channel_type: String,
}

/// Wrapper for the `POST /api/servers/:id/invites` reply (matches the
/// existing `{ code }` shape the legacy adapter expected).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateInviteResponse {
	pub code: String,
}
