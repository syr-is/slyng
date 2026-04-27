//! Friendships, blocks, ignores, the `RelationsSnapshot` summary, and
//! the `allow_dms` / `allow_friend_requests` policy enums.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum FriendshipStatus {
	#[serde(rename = "pending")]
	Pending,
	#[serde(rename = "accepted")]
	Accepted,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Friendship {
	pub id: String,
	pub user_a_id: String,
	pub user_b_id: String,
	pub status: FriendshipStatus,
	pub requested_by: String,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UserBlock {
	pub id: String,
	pub blocker_id: String,
	pub blocked_id: String,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UserIgnore {
	pub id: String,
	pub user_id: String,
	pub ignored_id: String,
	pub created_at: String,
	pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum AllowDms {
	#[serde(rename = "open")]
	Open,
	#[serde(rename = "friends_only")]
	FriendsOnly,
	#[serde(rename = "closed")]
	Closed,
}

impl Default for AllowDms {
	fn default() -> Self {
		Self::Open
	}
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum AllowFriendRequests {
	#[serde(rename = "open")]
	Open,
	#[serde(rename = "mutual")]
	Mutual,
	#[serde(rename = "closed")]
	Closed,
}

impl Default for AllowFriendRequests {
	fn default() -> Self {
		Self::Open
	}
}

/// One row inside `RelationsSnapshot.incoming` / `.outgoing`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PendingFriendRequest {
	/// "from" for incoming, "to" for outgoing — the API uses different
	/// keys for the two arrays, so we collapse them into one shape with
	/// `serde(alias)` and keep a single field name.
	#[serde(alias = "from", alias = "to")]
	pub did: String,
	pub created_at: String,
}

/// `GET /api/relations/snapshot` reply.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct RelationsSnapshot {
	#[serde(default)]
	pub friends: Vec<String>,
	#[serde(default)]
	pub incoming: Vec<PendingFriendRequest>,
	#[serde(default)]
	pub outgoing: Vec<PendingFriendRequest>,
	#[serde(default)]
	pub blocked: Vec<String>,
	#[serde(default)]
	pub ignored: Vec<String>,
	#[serde(default)]
	pub allow_dms: AllowDms,
	#[serde(default)]
	pub allow_friend_requests: AllowFriendRequests,
	#[serde(default)]
	pub instances: HashMap<String, String>,
}

/// Row in `Page<Friendship>` for `GET /api/relations/friends`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct FriendshipRow {
	pub user_id: String,
}

/// Row in `Page<...>` for `GET /api/relations/blocked`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BlockedRow {
	pub blocker_id: String,
	pub blocked_id: String,
	pub created_at: String,
}

/// Row in `Page<...>` for `GET /api/relations/ignored`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct IgnoredRow {
	pub user_id: String,
	pub ignored_id: String,
	pub created_at: String,
}
