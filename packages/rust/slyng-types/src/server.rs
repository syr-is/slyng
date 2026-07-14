//! Servers, members, roles, invites, bans, and channel categories.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Server {
	pub id: String,
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub icon_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub banner_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub invite_background_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub description: Option<String>,
	pub owner_id: String,
	#[serde(default)]
	pub member_count: u32,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ServerMember {
	pub id: String,
	pub server_id: String,
	pub user_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub nickname: Option<String>,
	#[serde(default)]
	pub role_ids: Vec<String>,
	pub joined_at: String,
	pub created_at: String,
	pub updated_at: String,
	// Optional federated metadata that some endpoints attach.
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub syr_instance_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ServerRole {
	pub id: String,
	pub server_id: String,
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub color: Option<String>,
	#[serde(default)]
	pub position: u32,
	/// Legacy single bitmask. Kept for backfill; new code uses
	/// `permissions_allow` / `permissions_deny`.
	#[serde(default = "zero_bits_string")]
	pub permissions: String,
	#[serde(default = "zero_bits_string")]
	pub permissions_allow: String,
	#[serde(default = "zero_bits_string")]
	pub permissions_deny: String,
	#[serde(default)]
	pub is_default: bool,
	#[serde(default)]
	pub deleted: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_at: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_by: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

fn zero_bits_string() -> String {
	"0".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum InviteTargetKind {
	#[serde(rename = "open")]
	Open,
	#[serde(rename = "instance")]
	Instance,
	#[serde(rename = "did")]
	Did,
}

impl Default for InviteTargetKind {
	fn default() -> Self {
		Self::Open
	}
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ServerInvite {
	pub id: String,
	pub server_id: String,
	pub code: String,
	pub created_by: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub expires_at: Option<String>,
	#[serde(default)]
	pub max_uses: u32,
	#[serde(default)]
	pub uses: u32,
	#[serde(default)]
	pub target_kind: InviteTargetKind,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub target_value: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub label: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ServerBan {
	pub id: String,
	pub server_id: String,
	pub user_id: String,
	pub banned_by: String,
	pub banned_at: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub reason: Option<String>,
	#[serde(default = "default_true")]
	pub active: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub unbanned_at: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub unbanned_by: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

fn default_true() -> bool {
	true
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ChannelCategory {
	pub id: String,
	pub server_id: String,
	pub name: String,
	#[serde(default)]
	pub position: u32,
	pub created_at: String,
	pub updated_at: String,
}

// ── Input shapes (request bodies) ───────────────────────────────────

/// Body for `POST /api/servers`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateServerInput {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub icon_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub banner_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub invite_background_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub description: Option<String>,
}

/// Body for `PATCH /api/servers/:id`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateServerInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub description: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub icon_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub banner_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub invite_background_url: Option<String>,
}

/// Body for `POST /api/servers/:id/transfer-ownership`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TransferOwnershipInput {
	pub new_owner_id: String,
}

/// Body for `POST /api/servers/:id/roles`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CreateRoleInput {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub color: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions_allow: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions_deny: Option<String>,
}

/// Body for `PATCH /api/roles/:id`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UpdateRoleInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub color: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions_allow: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub permissions_deny: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub position: Option<u32>,
}

/// Body for `POST /api/servers/:id/roles/reorder`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct RoleReorderInput {
	#[serde(rename = "roleIds")]
	pub role_ids: Vec<String>,
}
