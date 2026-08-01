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
/// null"). That holds for every presence caller on both platforms
/// today: all four idle-watcher sends pass a concrete `PresenceStatus`
/// (`userStatus` is initialised to `'online'` and only ever reassigned
/// from one), and both status-picker paths pass concrete strings
/// (`''` for clear). Nothing constructs a key with no value.
///
/// It is *not* enforced by the transports, and they do not even agree
/// with each other on what a JS `undefined`-valued key becomes:
///
/// - web — `Realtime::send` hands `d` to `serde_wasm_bindgen`, which
///   renders `{ status: undefined }` as `{"status":null}`.
/// - native — `invoke('realtime_send', …)` JSON-serialises the args, and
///   `JSON.stringify` drops undefined-valued keys, so the same literal
///   arrives as `{}`.
///
/// So a future caller that writes `{ custom_status: maybeUndefined }`
/// would be accepted on native and rejected on web. Pass `''` to clear
/// and omit the key otherwise, and the two agree. This is deliberately
/// not "fixed" by compacting nulls in the WS transport: `null` is
/// load-bearing on `VOICE_STATE_UPDATE`, whose leave frame is exactly
/// `{ channel_id: null }`. See the note on `Realtime::send` in
/// `packages/rust/slyng-client/src/wasm.rs`.
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
/// The gateway branches on `data.channel_id === null` → leave, so this
/// one key decides whether a user stays in the call. That makes it a
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

/// Server → client presence broadcast — the outbound half of op 6.
///
/// `custom_emoji` sits beside `custom_status` on the wire and always has:
/// the gateway puts both on the public and the self payload
/// (`broadcastPresenceUpdate` in
/// `apps/slyng/api/src/gateway/chat.gateway.ts`) and the client reads both
/// (`packages/ts/app-core/src/lib/stores/presence.svelte.ts`, the
/// `PRESENCE_UPDATE_BROADCAST` and `READY` handlers). The field was
/// missing here, which was harmless only because nothing validates
/// against this schema yet — wiring it in as-was would have stripped the
/// emoji from every broadcast and blanked it for every viewer.
///
/// Both are plain `String` rather than the length-bounded newtypes the
/// inbound patch uses. The bound's job is to reject oversized *input*;
/// anything reaching this struct already came through
/// `WsPresenceUpdatePayload`, so re-asserting it outbound could only ever
/// fail on data the server itself chose to send.
///
/// Keeping both custom fields optional is also what lets the struct
/// describe the masked variants: for an offline or invisible user the
/// gateway sends `user_id` + `status` alone, deliberately withholding the
/// custom status and emoji from other members.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct WsPresenceUpdateBroadcastPayload {
	pub user_id: String,
	pub status: crate::presence::PresenceStatus,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_status: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub custom_emoji: Option<String>,
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
