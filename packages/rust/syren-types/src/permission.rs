//! Permission overrides + the inline summary shapes returned by
//! `/api/servers/:id/members/@me/permissions` and friends.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "snake_case")]
pub enum PermissionScopeType {
	Server,
	Category,
	Channel,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "snake_case")]
pub enum PermissionTargetType {
	Role,
	User,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PermissionOverride {
	pub id: String,
	pub server_id: String,
	pub scope_type: PermissionScopeType,
	#[serde(default)]
	pub scope_id: Option<String>,
	pub target_type: PermissionTargetType,
	pub target_id: String,
	#[serde(default = "zero_bits_string")]
	pub allow: String,
	#[serde(default = "zero_bits_string")]
	pub deny: String,
	pub created_at: String,
	pub updated_at: String,
}

fn zero_bits_string() -> String {
	"0".to_string()
}

/// Body for `PUT /api/servers/:id/overrides`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpsertOverrideInput {
	pub scope_type: PermissionScopeType,
	#[serde(default)]
	pub scope_id: Option<String>,
	pub target_type: PermissionTargetType,
	pub target_id: String,
	pub allow: String,
	pub deny: String,
}

/// `GET /api/servers/:id/members/@me/permissions` reply.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MyPermissions {
	pub permissions: String,
	pub permissions_allow: String,
	pub permissions_deny: String,
	pub highest_role_position: u32,
	pub is_owner: bool,
}

/// `GET /api/servers/:id/members/:userId/permissions` reply (admin view).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct MemberPermissionsView {
	pub permissions: String,
	pub permissions_allow: String,
	pub permissions_deny: String,
	pub highest_role_position: u32,
	pub is_owner: bool,
	#[serde(default)]
	pub visible_channels: Vec<VisibleChannelSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct VisibleChannelSummary {
	pub id: String,
	pub name: String,
	#[serde(rename = "type")]
	pub channel_type: String,
}

/// Aggregated view used by the role manager: server perms + each
/// category and its channels with the actor's effective bitmask + a
/// `can_view` flag for the channel-tree filter.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PermissionTree {
	pub server: PermissionTreeServer,
	#[serde(default)]
	pub categories: Vec<PermissionTreeCategory>,
	#[serde(default)]
	pub uncategorized: Vec<PermissionTreeChannel>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PermissionTreeServer {
	pub permissions: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PermissionTreeCategory {
	pub id: String,
	pub name: String,
	pub position: u32,
	pub permissions: String,
	#[serde(default)]
	pub channels: Vec<PermissionTreeChannel>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PermissionTreeChannel {
	pub id: String,
	pub name: String,
	#[serde(rename = "type")]
	pub channel_type: String,
	pub position: u32,
	pub permissions: String,
	pub can_view: bool,
}
