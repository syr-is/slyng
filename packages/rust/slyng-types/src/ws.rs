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

/// Longest `custom_status` the gateway accepts, in UTF-16 code units.
///
/// Exactly the `maxlength` the only UI that produces one already
/// enforces — the "Custom status..." input in
/// `packages/ts/ui/src/lib/components/fragments/status-picker.svelte`.
/// Zod's `.max()` counts the same units the DOM's `maxlength` does, so
/// every value that input can hold is accepted and nothing wider is.
/// The gateway has no length check of its own and the value is
/// broadcast to every server member and persisted on the user row, so
/// the limit has to live in the contract or it does not exist.
pub const CUSTOM_STATUS_MAX_LEN: usize = 128;

/// Same, for the emoji slot beside it (the `🙂` input, `maxlength={4}`).
///
/// Four UTF-16 units covers a plain emoji, a regional-indicator flag
/// and an emoji + skin-tone modifier. It does not cover longer ZWJ
/// sequences — but neither does the input, so this rejects nothing a
/// client can currently send. Raise both together.
pub const CUSTOM_EMOJI_MAX_LEN: usize = 4;

/// A `custom_status` string on the wire — a plain string, length-bounded.
///
/// `zod_gen` has no length attribute, so the bound rides on a newtype
/// with a hand-written `ZodSchema`. `#[serde(transparent)]` keeps the
/// JSON byte-identical to a bare string in both directions, and the
/// `tsify(type = "string")` on the field below keeps the emitted
/// `.d.ts` referring to `string` rather than to this wrapper.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CustomStatusText(pub String);

impl zod_gen::ZodSchema for CustomStatusText {
	fn zod_schema() -> String {
		format!("{}.max({CUSTOM_STATUS_MAX_LEN})", zod_gen::zod_string())
	}
}

/// A `custom_emoji` string on the wire. See [`CustomStatusText`].
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CustomStatusEmoji(pub String);

impl zod_gen::ZodSchema for CustomStatusEmoji {
	fn zod_schema() -> String {
		format!("{}.max({CUSTOM_EMOJI_MAX_LEN})", zod_gen::zod_string())
	}
}

/// Client → server presence patch (op 6).
///
/// Every field is optional because the sender is a *patch*, not a full
/// state: `updateMyPresence(data: Partial<PresenceData>)`
/// (`packages/ts/app-core/src/lib/stores/presence.svelte.ts:48`) forwards
/// whatever subset the caller passed.
///
/// - `status` alone — the idle watcher
///   (`packages/ts/app-core/src/lib/stores/idle.svelte.ts:45,60,68,77`).
/// - `custom_status` + `custom_emoji` with **no** `status` — the status
///   picker's save and clear paths
///   (`packages/ts/ui/src/lib/components/fragments/status-picker.svelte:31,41`).
///
/// Absent vs. empty string are *different* instructions to the handler:
/// absent means "leave this alone", `""` means "clear it". See
/// `handlePresenceUpdate` in `apps/slyng/api/src/gateway/chat.gateway.ts`
/// — the two `data.<field> === undefined ? current.<field> : (…)`
/// ternaries. So no field may ever gain a default; a default would erase
/// that distinction and the status picker's Clear button with it.
///
/// "Optional" here means **key absent**, never an explicit `null` — the
/// repo-wide rule the generator states at
/// `packages/rust/slyng-types/src/bin/generate-zod.rs` ("omit, don't
/// null"). JS callers cannot violate it by accident: the WASM realtime
/// transport strips null-valued keys before the frame goes out
/// (`Realtime::send` in `packages/rust/slyng-client/src/wasm.rs` →
/// `body_from_jsv` → `transport::compact_nulls`), which turns a JS
/// `{ status: undefined }` — `serde_wasm_bindgen` renders that as
/// `Value::Null` — back into the absent key this schema expects.
///
/// `status` keeps the full `PresenceStatus` enum, `offline` included,
/// even though the handler only ever *acts* on
/// `online | idle | dnd | invisible`. `offline` is genuinely reachable
/// on the wire: `app-layout.svelte:84` feeds
/// `getPresenceData(did).status` into `syncStatus`, which yields
/// `offline` for a user not yet in the presence map (pre-READY, or after
/// their own entry was dropped), and the idle watcher then re-sends that
/// baseline on resume. The handler already treats it as "keep current
/// status"; narrowing the enum here would turn a benign no-op frame into
/// a rejected one.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsPresenceUpdatePayload {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub status: Option<crate::presence::PresenceStatus>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	#[cfg_attr(target_arch = "wasm32", tsify(type = "string"))]
	pub custom_status: Option<CustomStatusText>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	#[cfg_attr(target_arch = "wasm32", tsify(type = "string"))]
	pub custom_emoji: Option<CustomStatusEmoji>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsVoiceStateUpdatePayload {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub channel_id: Option<String>,
	#[serde(default)]
	pub self_mute: bool,
	#[serde(default)]
	pub self_deaf: bool,
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
