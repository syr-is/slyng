//! WASM WS transport (gloo-net::websocket). Single-threaded; uses
//! `wasm_bindgen_futures::spawn_local` for tasks and `Rc<RefCell<_>>`
//! for shared state. Mirrors the public surface implemented in
//! `native.rs`.

use super::{op, Frame, FrameCb, Inner, RealtimeClient, StateCb, WsState};
use futures_channel::mpsc;
use futures_util::{SinkExt, StreamExt};
use gloo_net::websocket::{futures::WebSocket, Message};
use serde_json::{json, Value as Json};
use std::rc::Rc;
use wasm_bindgen_futures::spawn_local;

impl RealtimeClient {
	pub async fn connect(&self) {
		{
			let mut guard = self.inner.borrow_mut();
			if guard.stopped {
				guard.stopped = false;
			}
			if matches!(guard.state, WsState::Connecting | WsState::Connected | WsState::Identified) {
				return;
			}
			guard.set_state(WsState::Connecting);
		}
		spawn_local(reconnect_loop(self.inner.clone()));
	}

	pub async fn disconnect(&self) {
		let mut guard = self.inner.borrow_mut();
		guard.stopped = true;
		guard.subscribed.clear();
		guard.pending.clear();
		guard.outgoing = None;
		guard.set_state(WsState::Disconnected);
	}

	pub async fn send(&self, op: u32, d: Json) {
		let frame = Frame { op, d };
		let mut guard = self.inner.borrow_mut();
		if guard.state == WsState::Identified {
			if let Some(tx) = &mut guard.outgoing {
				let _ = tx.unbounded_send(frame);
				return;
			}
		}
		guard.pending.push(frame);
	}

	pub async fn subscribe_channels(&self, ids: Vec<String>) {
		{
			let mut guard = self.inner.borrow_mut();
			for id in &ids {
				guard.subscribed.insert(id.clone());
			}
		}
		self.send(op::SUBSCRIBE, json!({ "channel_ids": ids })).await;
	}

	pub async fn unsubscribe_channels(&self, ids: Vec<String>) {
		{
			let mut guard = self.inner.borrow_mut();
			for id in &ids {
				guard.subscribed.remove(id);
			}
		}
		self.send(op::UNSUBSCRIBE, json!({ "channel_ids": ids })).await;
	}

	pub async fn send_typing(&self, channel_id: &str) {
		self.send(op::TYPING_START, json!({ "channel_id": channel_id })).await;
	}

	pub fn on_frame<F: Fn(Frame) + 'static>(&self, cb: F) {
		let cb: FrameCb = Rc::new(cb);
		self.inner.borrow_mut().on_frame = Some(cb);
	}

	pub fn on_state<F: Fn(WsState) + 'static>(&self, cb: F) {
		let cb: StateCb = Rc::new(cb);
		self.inner.borrow_mut().on_state = Some(cb);
	}
}

async fn reconnect_loop(inner: Rc<std::cell::RefCell<Inner>>) {
	loop {
		if inner.borrow().stopped {
			return;
		}

		let _ = connect_once(inner.clone()).await;

		if inner.borrow().stopped {
			return;
		}

		let attempt = {
			let mut g = inner.borrow_mut();
			g.set_state(WsState::Connecting);
			g.reconnect_attempt = g.reconnect_attempt.saturating_add(1);
			g.reconnect_attempt
		};
		let delay_ms = (1000u32.saturating_mul(1u32 << attempt.min(5))).min(30_000);
		gloo_timers::future::TimeoutFuture::new(delay_ms).await;
	}
}

async fn connect_once(inner: Rc<std::cell::RefCell<Inner>>) -> Result<(), String> {
	let (url, token) = {
		let g = inner.borrow();
		let store = g.store.clone();
		let mut u = g.base_url.clone();
		let scheme = if u.scheme() == "https" { "wss" } else { "ws" };
		u.set_scheme(scheme).map_err(|_| "scheme")?;
		u.set_path("/ws");
		drop(g);
		// `SessionStore::get` is async; release the borrow first.
		let token = store.get().await;
		(u, token)
	};

	let ws = WebSocket::open(url.as_str()).map_err(|e| e.to_string())?;
	let (mut writer, mut reader) = ws.split();

	let (tx, mut rx) = mpsc::unbounded::<Frame>();
	{
		let mut g = inner.borrow_mut();
		g.set_state(WsState::Connected);
		g.outgoing = Some(tx);
		g.reconnect_attempt = 0;
	}

	// IDENTIFY.
	if let Some(token) = token {
		let identify = Frame {
			op: op::IDENTIFY,
			d: json!({ "token": token }),
		};
		let payload = json!({ "event": "message", "data": identify });
		if writer.send(Message::Text(payload.to_string())).await.is_err() {
			return Err("identify send".into());
		}
	}

	// Flush + re-subscribe.
	{
		let mut g = inner.borrow_mut();
		g.set_state(WsState::Identified);
		let resub: Vec<String> = g.subscribed.iter().cloned().collect();
		if !resub.is_empty() {
			let f = Frame {
				op: op::SUBSCRIBE,
				d: json!({ "channel_ids": resub }),
			};
			if let Some(tx) = &mut g.outgoing {
				let _ = tx.unbounded_send(f);
			}
		}
		let drained: Vec<Frame> = std::mem::take(&mut g.pending);
		for f in drained {
			if let Some(tx) = &mut g.outgoing {
				let _ = tx.unbounded_send(f);
			}
		}
	}

	// Reader pump in its own task — gloo's reader is `!Send` so it
	// stays single-threaded.
	let reader_inner = inner.clone();
	spawn_local(async move {
		while let Some(msg) = reader.next().await {
			let Ok(Message::Text(t)) = msg else { continue };
			let Ok(frame) = serde_json::from_str::<Frame>(&t) else { continue };
			let cb = reader_inner.borrow().on_frame.clone();
			if let Some(cb) = cb {
				cb(frame);
			}
		}
		// Reader closed → mark disconnected so the outer reconnect loop kicks.
		let mut g = reader_inner.borrow_mut();
		g.outgoing = None;
		g.set_state(WsState::Disconnected);
	});

	// Heartbeat ticker — runs alongside the writer pump below.
	let heartbeat_inner = inner.clone();
	spawn_local(async move {
		loop {
			gloo_timers::future::TimeoutFuture::new(45_000).await;
			let still_identified =
				heartbeat_inner.borrow().state == WsState::Identified;
			if !still_identified {
				return;
			}
			let f = Frame { op: op::HEARTBEAT, d: Json::Null };
			let mut g = heartbeat_inner.borrow_mut();
			if let Some(tx) = &mut g.outgoing {
				let _ = tx.unbounded_send(f);
			} else {
				return;
			}
		}
	});

	// Writer pump — owns the writer half.
	while let Some(frame) = rx.next().await {
		let payload = json!({ "event": "message", "data": frame });
		if writer.send(Message::Text(payload.to_string())).await.is_err() {
			break;
		}
	}

	{
		let mut g = inner.borrow_mut();
		g.outgoing = None;
		g.set_state(WsState::Disconnected);
	}

	Ok(())
}
