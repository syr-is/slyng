//! WebSocket transport. Two impls behind one public API:
//! native uses `tokio-tungstenite`, WASM uses `gloo-net::websocket`.
//!
//! The opcode space and event payloads mirror
//! `packages/ts/types/src/ws.ts`. We reproduce the integer constants
//! here as a const block rather than depending on a generated bridge —
//! keeps the WASM bundle small and the wire compatibility explicit.

use serde::{Deserialize, Serialize};

#[allow(non_upper_case_globals, dead_code)]
pub mod op {
	// Client → Server
	pub const IDENTIFY: u8 = 1;
	pub const HEARTBEAT: u8 = 2;
	pub const SUBSCRIBE: u8 = 3;
	pub const UNSUBSCRIBE: u8 = 4;
	pub const TYPING_START: u8 = 5;
	pub const PRESENCE_UPDATE: u8 = 6;
	pub const VOICE_STATE_UPDATE: u8 = 7;

	// Server → Client
	pub const READY: u8 = 10;
	pub const HEARTBEAT_ACK: u8 = 11;
	pub const MESSAGE_CREATE: u8 = 20;
	pub const MESSAGE_UPDATE: u8 = 21;
	pub const MESSAGE_DELETE: u8 = 22;
	pub const TYPING_START_BROADCAST: u8 = 25;
	pub const PRESENCE_UPDATE_BROADCAST: u8 = 26;
	pub const CHANNEL_CREATE: u8 = 28;
	pub const CHANNEL_DELETE: u8 = 29;
	pub const CHANNEL_UPDATE: u8 = 30;
	pub const SERVER_UPDATE: u8 = 31;
	pub const ROLE_CREATE: u8 = 32;
	pub const ROLE_UPDATE: u8 = 33;
	pub const ROLE_DELETE: u8 = 34;
	pub const MEMBER_ADD: u8 = 35;
	pub const MEMBER_UPDATE: u8 = 36;
	pub const MEMBER_REMOVE: u8 = 37;
	pub const PIN_ADD: u8 = 38;
	pub const PIN_REMOVE: u8 = 39;
	pub const REACTION_ADD: u8 = 40;
	pub const REACTION_REMOVE: u8 = 41;
	pub const PROFILE_UPDATE: u8 = 42;
	pub const VOICE_STATE_BROADCAST: u8 = 43;
	pub const AUDIT_LOG_APPEND: u8 = 44;

	// WebRTC signaling
	pub const RTC_OFFER: u8 = 100;
	pub const RTC_ANSWER: u8 = 101;
	pub const RTC_ICE: u8 = 102;
}

/// A single frame on the wire — `{ op, d }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
	pub op: u8,
	pub d: serde_json::Value,
}

#[cfg(not(target_arch = "wasm32"))]
mod native;
#[cfg(not(target_arch = "wasm32"))]
pub use native::Connection;

#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(target_arch = "wasm32")]
pub use wasm::Connection;
