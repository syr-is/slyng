use super::Frame;
use crate::client::Client;
use crate::error::{Error, Result};
use futures_util::{SinkExt, StreamExt};
use gloo_net::websocket::{futures::WebSocket, Message};
use std::sync::Arc;
use std::sync::Mutex;
use wasm_bindgen_futures::spawn_local;

/// WASM connection. Mirrors the native API but runs in the browser
/// event loop. Outgoing messages buffered in a Vec behind a Mutex
/// because gloo-net's WebSocket isn't `Send`. A pump task wakes on
/// each `send()` to flush.
pub struct Connection {
	outbox: Arc<Mutex<Vec<Frame>>>,
	on_frame: Arc<Mutex<Option<Box<dyn Fn(Frame)>>>>,
}

impl Connection {
	pub async fn connect(client: &Client) -> Result<Self> {
		let mut url = client.base().clone();
		let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
		url.set_scheme(scheme).map_err(|_| Error::Network("scheme".into()))?;
		url.set_path("/ws");

		let _token = client.store().get().await;

		let ws = WebSocket::open(url.as_str()).map_err(|e| Error::Ws(e.to_string()))?;
		let (mut writer, mut reader) = ws.split();

		let outbox = Arc::new(Mutex::new(Vec::<Frame>::new()));
		let on_frame: Arc<Mutex<Option<Box<dyn Fn(Frame)>>>> = Arc::new(Mutex::new(None));

		// Reader pump
		let reader_cb = on_frame.clone();
		spawn_local(async move {
			while let Some(msg) = reader.next().await {
				let Ok(Message::Text(t)) = msg else { continue };
				let Ok(frame) = serde_json::from_str::<Frame>(&t) else { continue };
				if let Some(cb) = reader_cb.lock().ok().and_then(|g| g.as_ref().map(|f| f as *const _)) {
					unsafe {
						let f: &dyn Fn(Frame) = &**(cb as *const Box<dyn Fn(Frame)>);
						f(frame);
					}
				}
			}
		});

		// Writer pump — wakes via gloo timer every 25 ms; cheap.
		let writer_outbox = outbox.clone();
		spawn_local(async move {
			loop {
				gloo_timers::future::TimeoutFuture::new(25).await;
				let drained: Vec<Frame> = match writer_outbox.lock() {
					Ok(mut g) => std::mem::take(&mut *g),
					Err(_) => continue,
				};
				for f in drained {
					let payload = serde_json::json!({ "event": "message", "data": f });
					if writer
						.send(Message::Text(payload.to_string()))
						.await
						.is_err()
					{
						return;
					}
				}
			}
		});

		Ok(Self { outbox, on_frame })
	}

	pub fn send(&self, frame: Frame) {
		if let Ok(mut g) = self.outbox.lock() {
			g.push(frame);
		}
	}

	pub fn on_frame<F: Fn(Frame) + 'static>(&self, cb: F) {
		if let Ok(mut g) = self.on_frame.lock() {
			*g = Some(Box::new(cb));
		}
	}
}
