//! Native WS transport (tokio-tungstenite). Owns the connect →
//! identify → pump → reconnect loop. The public surface is on
//! `RealtimeClient` in `mod.rs`; this file contributes the
//! target-specific implementation of its async methods.

use super::{op, Frame, FrameCb, Inner, RealtimeClient, StateCb, WsState};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value as Json};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;
use tokio_tungstenite::tungstenite::Message;

impl RealtimeClient {
	/// Open the socket, send IDENTIFY, start the read/write/heartbeat
	/// pumps, and return. Subsequent disconnects are handled internally
	/// by the spawned reconnect loop until `disconnect()` is called.
	pub async fn connect(&self) {
		let inner = self.inner.clone();
		{
			let mut guard = inner.lock().await;
			if guard.stopped {
				guard.stopped = false;
			}
			if matches!(guard.state, WsState::Connecting | WsState::Connected | WsState::Identified) {
				return;
			}
			guard.set_state(WsState::Connecting);
		}
		tokio::spawn(reconnect_loop(inner));
	}

	pub async fn disconnect(&self) {
		let mut guard = self.inner.lock().await;
		guard.stopped = true;
		guard.subscribed.clear();
		guard.pending.clear();
		guard.outgoing = None;
		guard.set_state(WsState::Disconnected);
	}

	/// Queue or send a frame. Frames sent before IDENTIFY are buffered
	/// in `pending` and flushed once the socket is identified.
	pub async fn send(&self, op: u32, d: Json) {
		let frame = Frame { op, d };
		let mut guard = self.inner.lock().await;
		if guard.state == WsState::Identified {
			if let Some(tx) = &guard.outgoing {
				let _ = tx.send(frame);
				return;
			}
		}
		guard.pending.push(frame);
	}

	pub async fn subscribe_channels(&self, ids: Vec<String>) {
		{
			let mut guard = self.inner.lock().await;
			for id in &ids {
				guard.subscribed.insert(id.clone());
			}
		}
		self.send(op::SUBSCRIBE, json!({ "channel_ids": ids })).await;
	}

	pub async fn unsubscribe_channels(&self, ids: Vec<String>) {
		{
			let mut guard = self.inner.lock().await;
			for id in &ids {
				guard.subscribed.remove(id);
			}
		}
		self.send(op::UNSUBSCRIBE, json!({ "channel_ids": ids })).await;
	}

	pub async fn send_typing(&self, channel_id: &str) {
		self.send(op::TYPING_START, json!({ "channel_id": channel_id })).await;
	}

	pub fn on_frame<F: Fn(Frame) + Send + Sync + 'static>(&self, cb: F) {
		let inner = self.inner.clone();
		// Block briefly to install the callback. The lock is held only
		// for the moment of assignment; reader pump tasks read it via
		// `clone()` so they don't contend.
		let cb: FrameCb = Arc::new(cb);
		tokio::spawn(async move {
			let mut g = inner.lock().await;
			g.on_frame = Some(cb);
		});
	}

	pub fn on_state<F: Fn(WsState) + Send + Sync + 'static>(&self, cb: F) {
		let inner = self.inner.clone();
		let cb: StateCb = Arc::new(cb);
		tokio::spawn(async move {
			let mut g = inner.lock().await;
			g.on_state = Some(cb);
		});
	}
}

async fn reconnect_loop(inner: Arc<AsyncMutex<Inner>>) {
	loop {
		// Check stop flag.
		{
			let g = inner.lock().await;
			if g.stopped {
				return;
			}
		}

		match connect_once(inner.clone()).await {
			Ok(()) => {
				// connect_once returned: connection ended cleanly or remotely.
			}
			Err(e) => {
				#[cfg(debug_assertions)]
				eprintln!("[realtime] connect failed: {e}");
				let _ = e;
			}
		}

		// Was disconnect called while connected?
		{
			let g = inner.lock().await;
			if g.stopped {
				return;
			}
		}

		// Backoff for the next attempt.
		let attempt = {
			let mut g = inner.lock().await;
			g.set_state(WsState::Connecting);
			g.reconnect_attempt = g.reconnect_attempt.saturating_add(1);
			g.reconnect_attempt
		};
		let delay_ms = (1000u64.saturating_mul(1u64 << attempt.min(5))).min(30_000);
		tokio::time::sleep(Duration::from_millis(delay_ms)).await;
	}
}

async fn connect_once(inner: Arc<AsyncMutex<Inner>>) -> Result<(), String> {
	let (url, token) = {
		let g = inner.lock().await;
		let token = g.store.get().await;
		let mut u = g.base_url.clone();
		let scheme = if u.scheme() == "https" { "wss" } else { "ws" };
		u.set_scheme(scheme).map_err(|_| "scheme")?;
		u.set_path("/ws");
		(u, token)
	};

	let (ws, _resp) = tokio_tungstenite::connect_async(url.as_str())
		.await
		.map_err(|e| e.to_string())?;
	let (mut sink, mut stream) = ws.split();

	let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
	{
		let mut g = inner.lock().await;
		g.set_state(WsState::Connected);
		g.outgoing = Some(tx);
		g.reconnect_attempt = 0;
	}

	// IDENTIFY before anything else.
	if let Some(token) = token {
		let identify = Frame {
			op: op::IDENTIFY,
			d: json!({ "token": token }),
		};
		let payload = json!({ "event": "message", "data": identify });
		if let Err(e) = sink.send(Message::Text(payload.to_string())).await {
			return Err(format!("identify send: {e}"));
		}
	}

	// Re-subscribe + flush queued sends now that we're identified.
	{
		let mut g = inner.lock().await;
		g.set_state(WsState::Identified);
		let resub: Vec<String> = g.subscribed.iter().cloned().collect();
		if !resub.is_empty() {
			let f = Frame {
				op: op::SUBSCRIBE,
				d: json!({ "channel_ids": resub }),
			};
			if let Some(out) = &g.outgoing {
				let _ = out.send(f);
			}
		}
		let drained: Vec<Frame> = std::mem::take(&mut g.pending);
		for f in drained {
			if let Some(out) = &g.outgoing {
				let _ = out.send(f);
			}
		}
	}

	let mut heartbeat = tokio::time::interval(Duration::from_secs(45));
	heartbeat.tick().await; // first tick fires immediately; skip it

	loop {
		tokio::select! {
			Some(frame) = rx.recv() => {
				let payload = json!({ "event": "message", "data": frame });
				if sink.send(Message::Text(payload.to_string())).await.is_err() {
					break;
				}
			}
			Some(msg) = stream.next() => {
				match msg {
					Ok(Message::Text(t)) => {
						if let Ok(frame) = serde_json::from_str::<Frame>(&t) {
							let cb = inner.lock().await.on_frame.clone();
							if let Some(cb) = cb {
								cb(frame);
							}
						}
					}
					Ok(Message::Close(_)) | Err(_) => break,
					_ => {}
				}
			}
			_ = heartbeat.tick() => {
				let f = Frame { op: op::HEARTBEAT, d: Json::Null };
				let payload = json!({ "event": "message", "data": f });
				if sink.send(Message::Text(payload.to_string())).await.is_err() {
					break;
				}
			}
		}
	}

	{
		let mut g = inner.lock().await;
		g.outgoing = None;
		g.set_state(WsState::Disconnected);
	}

	Ok(())
}
