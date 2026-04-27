//! Realtime (WebSocket) client.
//!
//! One `RealtimeClient` per app process. Owns the socket, IDENTIFY
//! handshake, heartbeat, exponential-backoff reconnect, and subscription
//! state (so reconnects auto-resubscribe to the channels the caller
//! originally requested). Consumers register a single
//! `on_frame(op, data)` callback; routing by opcode happens on the
//! JS side, where the existing `onWsEvent(op, handler)` API in
//! `ws.svelte.ts` already does that work.
//!
//! Two transport backends behind a uniform public API:
//! - native (`tokio-tungstenite`)
//! - wasm32 (`gloo-net::websocket`)
//!
//! The wire format is `{ event: 'message', data: { op, d } }` for
//! outgoing frames (the NestJS `@SubscribeMessage('message')` shape)
//! and `{ op, d }` for incoming frames.

use crate::session::SessionStore;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::HashSet;
use std::sync::Arc;
use url::Url;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;

#[cfg(not(target_arch = "wasm32"))]
use tokio::sync::Mutex as AsyncMutex;

/// Numeric opcodes mirrored from `packages/rust/syren-types/src/ws.rs::WsOp`.
/// Hard-coded here so the WS layer doesn't depend on the full types
/// surface — keeps the WASM bundle a touch leaner. Kept in sync via
/// the workspace's `cargo check`.
#[allow(non_upper_case_globals, dead_code)]
pub mod op {
	pub const IDENTIFY: u32 = 1;
	pub const HEARTBEAT: u32 = 2;
	pub const SUBSCRIBE: u32 = 3;
	pub const UNSUBSCRIBE: u32 = 4;
	pub const TYPING_START: u32 = 5;
}

/// One frame on the wire — `{ op, d }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
	pub op: u32,
	#[serde(default)]
	pub d: Json,
}

/// Coarse connection state, surfaced to JS so the UI can render
/// "connecting…" / "reconnecting…" indicators. `Identified` is the only
/// state in which `send()` writes immediately; everything else queues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WsState {
	Disconnected,
	Connecting,
	Connected,
	Identified,
}

#[cfg(not(target_arch = "wasm32"))]
type FrameCb = Arc<dyn Fn(Frame) + Send + Sync + 'static>;
#[cfg(target_arch = "wasm32")]
type FrameCb = Rc<dyn Fn(Frame) + 'static>;

#[cfg(not(target_arch = "wasm32"))]
type StateCb = Arc<dyn Fn(WsState) + Send + Sync + 'static>;
#[cfg(target_arch = "wasm32")]
type StateCb = Rc<dyn Fn(WsState) + 'static>;

/// Shared state. Both transport impls hold an `Arc`/`Rc` to this and
/// mutate it from their reader/writer pumps.
struct Inner {
	base_url: Url,
	store: Arc<dyn SessionStore>,
	state: WsState,
	subscribed: HashSet<String>,
	pending: Vec<Frame>,
	on_frame: Option<FrameCb>,
	on_state: Option<StateCb>,
	reconnect_attempt: u32,
	stopped: bool,
	#[cfg(not(target_arch = "wasm32"))]
	outgoing: Option<tokio::sync::mpsc::UnboundedSender<Frame>>,
	#[cfg(target_arch = "wasm32")]
	outgoing: Option<futures_channel::mpsc::UnboundedSender<Frame>>,
}

impl Inner {
	fn set_state(&mut self, new_state: WsState) {
		if self.state == new_state {
			return;
		}
		self.state = new_state;
		if let Some(cb) = self.on_state.clone() {
			cb(new_state);
		}
	}
}

/// Public realtime handle. Cheap to clone — internal state is shared
/// via `Arc`/`Rc`.
#[derive(Clone)]
pub struct RealtimeClient {
	#[cfg(not(target_arch = "wasm32"))]
	inner: Arc<AsyncMutex<Inner>>,
	#[cfg(target_arch = "wasm32")]
	inner: Rc<RefCell<Inner>>,
}

impl RealtimeClient {
	/// Build a client from an existing API client. Reuses its base URL
	/// (with scheme rewritten to ws/wss) and its session store.
	pub fn from_client(client: &crate::Client) -> Self {
		Self::new(client.base().clone(), client.store())
	}

	pub fn new(base_url: Url, store: Arc<dyn SessionStore>) -> Self {
		let inner = Inner {
			base_url,
			store,
			state: WsState::Disconnected,
			subscribed: HashSet::new(),
			pending: Vec::new(),
			on_frame: None,
			on_state: None,
			reconnect_attempt: 0,
			stopped: false,
			outgoing: None,
		};
		#[cfg(not(target_arch = "wasm32"))]
		{
			Self {
				inner: Arc::new(AsyncMutex::new(inner)),
			}
		}
		#[cfg(target_arch = "wasm32")]
		{
			Self {
				inner: Rc::new(RefCell::new(inner)),
			}
		}
	}
}

#[cfg(not(target_arch = "wasm32"))]
mod native;
#[cfg(target_arch = "wasm32")]
mod wasm;
