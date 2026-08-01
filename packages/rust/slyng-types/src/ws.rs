//! WebSocket opcodes + every typed payload struct used by the chat
//! gateway. Mirrors `apps/slyng/api/src/gateway/chat.gateway.ts` and the
//! existing TS `WsOp` enum so the JS and Rust ends speak the same wire
//! protocol.
//!
//! Wire format on the gateway is `{ op: number, d: <payload> }`. This
//! module models each `op` as a numeric constant and each payload as a
//! struct named after the op (`WsReadyPayload`, `WsMessageCreatePayload`,
//! …). A `RealtimeClient` (Phase 9) consumes incoming frames by reading
//! the `op` and routing to the matching payload deserialiser.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// Numeric opcodes used by the chat gateway. Constants match
/// `packages/ts/types/src/ws.ts::WsOp`. `ZodSchema` is intentionally
/// not derived — `WsOp` serialises as a `u32`, and the generated TS
/// view of it is just a plain number; consumers route on the constant
/// values directly.
#[allow(non_camel_case_types)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(into = "u32", try_from = "u32")]
pub enum WsOp {
	Identify = 1,
	Heartbeat = 2,
	Subscribe = 3,
	Unsubscribe = 4,
	TypingStart = 5,
	PresenceUpdate = 6,
	VoiceStateUpdate = 7,

	Ready = 10,
	HeartbeatAck = 11,
	MessageCreate = 20,
	MessageUpdate = 21,
	MessageDelete = 22,
	TypingStartBroadcast = 25,
	PresenceUpdateBroadcast = 26,
	ChannelCreate = 28,
	ChannelDelete = 29,
	ChannelUpdate = 30,
	MemberUpdate = 31,
	MemberRemove = 32,
	RoleCreate = 33,
	RoleUpdate = 34,
	RoleDelete = 35,
	VoiceStateUpdateBroadcast = 36,
	ServerUpdate = 37,
	ServerDelete = 38,
	ReactionAdd = 40,
	ReactionRemove = 41,
	PinAdd = 42,
	PinRemove = 43,
	AuditLogAppend = 44,
	PermissionOverrideUpdate = 45,
	CategoryCreate = 46,
	CategoryUpdate = 47,
	CategoryDelete = 48,

	WatchProfiles = 50,
	UnwatchProfiles = 51,
	ProfileUpdate = 52,

	FriendRequestReceive = 53,
	FriendRequestUpdate = 54,
	BlockUpdate = 55,
	IgnoreUpdate = 56,
	DmPolicyUpdate = 57,
	DmChannelCreate = 58,

	ServerEmojiUpdate = 59,
	MentionAdd = 60,
}

impl From<WsOp> for u32 {
	fn from(op: WsOp) -> Self {
		op as u32
	}
}

impl TryFrom<u32> for WsOp {
	type Error = String;

	fn try_from(value: u32) -> Result<Self, Self::Error> {
		use WsOp::*;
		Ok(match value {
			1 => Identify,
			2 => Heartbeat,
			3 => Subscribe,
			4 => Unsubscribe,
			5 => TypingStart,
			6 => PresenceUpdate,
			7 => VoiceStateUpdate,
			10 => Ready,
			11 => HeartbeatAck,
			20 => MessageCreate,
			21 => MessageUpdate,
			22 => MessageDelete,
			25 => TypingStartBroadcast,
			26 => PresenceUpdateBroadcast,
			28 => ChannelCreate,
			29 => ChannelDelete,
			30 => ChannelUpdate,
			31 => MemberUpdate,
			32 => MemberRemove,
			33 => RoleCreate,
			34 => RoleUpdate,
			35 => RoleDelete,
			36 => VoiceStateUpdateBroadcast,
			37 => ServerUpdate,
			38 => ServerDelete,
			40 => ReactionAdd,
			41 => ReactionRemove,
			42 => PinAdd,
			43 => PinRemove,
			44 => AuditLogAppend,
			45 => PermissionOverrideUpdate,
			46 => CategoryCreate,
			47 => CategoryUpdate,
			48 => CategoryDelete,
			50 => WatchProfiles,
			51 => UnwatchProfiles,
			52 => ProfileUpdate,
			53 => FriendRequestReceive,
			54 => FriendRequestUpdate,
			55 => BlockUpdate,
			56 => IgnoreUpdate,
			57 => DmPolicyUpdate,
			58 => DmChannelCreate,
			59 => ServerEmojiUpdate,
			60 => MentionAdd,
			other => return Err(format!("unknown WsOp {other}")),
		})
	}
}

/// Generic envelope: `{ op, d }`. Consumers parse this first, then
/// route on `op` to the matching payload type.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsEnvelope {
	pub op: u32,
	#[serde(default)]
	pub d: JsonValue,
}

// ── Client → Server payloads ──

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsIdentifyPayload {
	pub token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsSubscribePayload {
	pub channel_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsTypingStartPayload {
	pub channel_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsPresenceUpdatePayload {
	pub status: crate::presence::PresenceStatus,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_status: Option<String>,
}

/// A **required** key whose value is either a string or an explicit
/// `null` — a tri-state field (`"x"` / `null`) rather than a two-state
/// one (`"x"` / absent).
///
/// `Option<String>` cannot express this. It emits `.nullable()`, which
/// `bin/generate-zod.rs` then rewrites wholesale into `.optional()`, and
/// that is wrong twice over: `.optional()` rejects an explicit `null`
/// *and* it makes the key omissible. For a field whose null carries
/// meaning — a discriminator, say — omitting it must be an error, not a
/// silent synonym for null.
///
/// The emission is spelled `z.union([z.string(), z.null()])` rather than
/// `z.string().nullable()` deliberately: it is the same schema, but it
/// survives the generator's global `.nullable()` → `.optional()` pass
/// untouched, so an explicitly-nullable field cannot be flattened back
/// into an optional one by a rewrite it never opted into. The union is
/// also left alone by `unit_union_to_enum` (its members aren't string
/// literals).
///
/// On the Rust side it is still `Option<String>`, so `None` round-trips
/// back out as `null` rather than vanishing from the object.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NullableString(pub Option<String>);

impl zod_gen::ZodSchema for NullableString {
	fn zod_schema() -> String {
		format!("z.union([{}, z.null()])", zod_gen::zod_string())
	}
}

/// `d` for op 7 (`VOICE_STATE_UPDATE`), client → server.
///
/// The audio/video flags are a **patch**, not a snapshot: a client sends
/// only the ones it is changing. `channel_id` is not — it is the
/// discriminator, and every frame carries it. Both voice engines
/// (`packages/ts/app-core/src/lib/voice/voice-engine.ts` and
/// `livekit-engine.ts`) emit exactly four shapes, all four with the key:
///
/// - join —          `{ channel_id, self_mute, self_deaf }`, LiveKit adds
///                   `has_camera` + `has_screen`
/// - leave —         `{ channel_id: null }`, an **explicit null** with no
///                   other key present
/// - mute / deafen — `{ channel_id, self_mute, self_deaf }`
/// - camera/screen — `{ channel_id, has_camera, has_screen }`
///
/// The gateway branches on `if (!data.channel_id)` → leave, so the key's
/// presence decides whether a user stays in the call. That makes it a
/// [`NullableString`] and not an `Option<String>`: a plain `.optional()`
/// schema would reject the leave frame's explicit `null` outright, while
/// a `.nullish()` one would accept a frame that simply forgot the key and
/// quietly drop that user out of voice. Required key, nullable value —
/// omitting it is a malformed frame and gets logged and dropped.
///
/// `self_mute` / `self_deaf` / `has_camera` / `has_screen` stay optional;
/// those genuinely are patch fields, and the handler's
/// `data.has_camera !== undefined` checks depend on absent staying
/// distinguishable from `false`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsVoiceStateUpdatePayload {
	#[cfg_attr(target_arch = "wasm32", tsify(type = "string | null"))]
	pub channel_id: NullableString,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub self_mute: Option<bool>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub self_deaf: Option<bool>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub has_camera: Option<bool>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub has_screen: Option<bool>,
}

// ── Server → Client payloads ──

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyPayload {
	pub user_id: String,
	#[serde(default)]
	pub servers: Vec<WsReadyServer>,
	#[serde(default)]
	pub dm_channels: Vec<WsReadyDmChannel>,
	#[serde(default)]
	pub presences: Vec<WsReadyPresence>,
	#[serde(default)]
	pub unread: Vec<WsReadyUnread>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyServer {
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub icon_url: Option<String>,
	#[serde(default)]
	pub channels: Vec<WsReadyChannel>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyChannel {
	pub id: String,
	#[serde(default)]
	pub name: Option<String>,
	#[serde(rename = "type")]
	pub channel_type: String,
	#[serde(default)]
	pub position: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyDmChannel {
	pub id: String,
	#[serde(default)]
	pub participants: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyPresence {
	pub user_id: String,
	pub status: crate::presence::PresenceStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReadyUnread {
	pub channel_id: String,
	pub count: u32,
	pub mention_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsTypingStartBroadcastPayload {
	pub channel_id: String,
	pub user_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsPresenceUpdateBroadcastPayload {
	pub user_id: String,
	pub status: crate::presence::PresenceStatus,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsMessageDeletePayload {
	pub channel_id: String,
	pub message_id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsChannelDeletePayload {
	pub id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub server_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsMemberRemovePayload {
	pub server_id: String,
	pub user_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsRoleDeletePayload {
	pub id: String,
	pub server_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsServerDeletePayload {
	pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsReactionPayload {
	pub channel_id: String,
	pub message_id: String,
	pub user_id: String,
	pub kind: crate::reaction::ReactionKind,
	pub value: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub image_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsPinPayload {
	pub channel_id: String,
	pub message_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsCategoryDeletePayload {
	pub id: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub server_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsWatchProfilesPayload {
	pub profiles: Vec<WsWatchProfileEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsWatchProfileEntry {
	pub did: String,
	pub instance_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsUnwatchProfilesPayload {
	pub dids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsProfileUpdatePayload {
	pub did: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsFriendRequestReceivePayload {
	pub from: String,
	pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsFriendRequestUpdatePayload {
	pub did: String,
	pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsBlockUpdatePayload {
	pub did: String,
	pub blocked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsIgnoreUpdatePayload {
	pub did: String,
	pub ignored: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsDmPolicyUpdatePayload {
	pub allow_dms: crate::relation::AllowDms,
	pub allow_friend_requests: crate::relation::AllowFriendRequests,
}
