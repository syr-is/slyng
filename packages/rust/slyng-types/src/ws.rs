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

/// `IDENTIFY` (op 1). The session token, always present: the client skips
/// the frame entirely when it holds no bearer rather than sending an empty
/// one (`slyng-client/src/ws/native.rs:183`, `wasm.rs:134`). The gateway
/// also raises this payload internally from the `slyng_session` cookie on
/// connect — the `handleIdentify(client, { token: match[1] })` call inside
/// `ChatGateway.handleConnection` (`chat.gateway.ts:97`).
///
/// `HEARTBEAT` (op 2) has no struct here on purpose. The client sends it as
/// `{"op":2,"d":null}` (`native.rs:270`, `wasm.rs:195`) and the handler
/// reads nothing off `d`, so there is no contract to state; an empty struct
/// would only add a way for a payload-free frame to be rejected.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsIdentifyPayload {
	pub token: String,
}

/// `SUBSCRIBE` (op 3) and `UNSUBSCRIBE` (op 4) — the two frames carry the
/// same shape and there is deliberately no separate `WsUnsubscribePayload`;
/// this is the seam that has to split first if they ever diverge.
///
/// `SUBSCRIBE` is additive and idempotent per topic; `UNSUBSCRIBE` is
/// subtractive. Neither replaces the socket's subscription set, so a frame
/// carrying one topic leaves every other subscription intact. Both shapes
/// occur in practice: the whole topic list (server topic plus every channel)
/// on server load (`ui/src/lib/components/pages/server-layout.svelte:140`)
/// and on reconnect resubscribe (`slyng-client/src/ws/native.rs:203-212`,
/// which replays the accumulated set), and a single topic or a delta on
/// channel open (`pages/channel-page.svelte:121`, `pages/dm-channel.svelte:85`),
/// voice join (`app-core/src/lib/voice/voice-engine.ts:267`) and
/// newly-visible channels (`server-layout.svelte:188,267`, both a
/// `.filter(id => !known.has(id))` delta).
///
/// The transport is a pass-through — `native.rs:64` / `wasm.rs:57` send
/// `json!({ "channel_ids": ids })` over whatever `Vec<String>` the caller
/// supplied — so the wire shape is identical in every case and carries no
/// hint of which one it is. The field is required: the handler iterates it
/// directly. Per-entry policy (salvaging valid ids, dropping bad ones) is
/// the handler's business, not this schema's.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsSubscribePayload {
	pub channel_ids: Vec<String>,
}

/// `TYPING_START` (op 5). One channel per frame, always present —
/// `slyng-client/src/ws/native.rs:78`, `wasm.rs:71`.
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

/// `WATCH_PROFILES` (op 50). The client registers interest in a set of DIDs.
/// The frame carries the full roster only on first registration; thereafter
/// it carries an incremental set of newly-watchable members. Both call sites
/// filter against what they already watch before sending — server members
/// with a known instance minus the already-watched
/// (`ui/src/lib/components/pages/server-layout.svelte:201-204`,
/// `.filter(m => !!m.syr_instance_url && !currentDids.has(m.user_id))`) and
/// friends minus the already-watched (`pages/dm-friends.svelte:33,37`,
/// `next.filter(p => !currentDids.has(p.did))`) — so after the first frame
/// the payload is a delta, and members that go away leave via
/// `UNWATCH_PROFILES` rather than by omission here.
///
/// Registration is idempotent per DID per socket and ref-counted across
/// sockets — `ProfileWatcherService.register` skips a DID the socket already
/// holds (`profile-watcher.service.ts:75`) and otherwise bumps `refcount`
/// (`:80`) — so a repeated or overlapping frame is harmless and a re-sent
/// full roster is equally safe. Both sites build entries as bare
/// `{ did, instance_url }` literals, so the frame carries these two fields
/// and nothing else. Required: `profiles` is the whole payload.
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

/// `UNWATCH_PROFILES` (op 51).
///
/// `dids` is **optional**, and the two cases mean different things:
/// a list drops those watches, an absent list drops every watch the socket
/// holds — `ProfileWatcherService.unregister` resolves it as
/// `dids ?? [...sub]` (`profile-watcher.service.ts:90`), which is the same
/// path `forgetClient` takes on disconnect. `ChatGateway.handleUnwatchProfiles`
/// (`chat.gateway.ts:468`) has always accepted the absent case — it took
/// `{ dids?: string[] }` before this change and takes
/// `dids: string[] | undefined` after it, the dispatch site passing
/// `undefined` when the field is absent. Declaring `dids` required here was
/// drift, and enforcing it would have turned "drop everything" into a
/// rejected frame.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsUnwatchProfilesPayload {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub dids: Option<Vec<String>>,
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
