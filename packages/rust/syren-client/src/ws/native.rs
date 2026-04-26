use super::Frame;
use crate::client::Client;
use crate::error::{Error, Result};
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

/// Native (non-WASM) WS connection. Spawns a background task that owns
/// the socket; the public surface is two channels — `incoming` for
/// frames from the server, `outgoing` for frames the caller sends.
/// Heartbeat ticks every 45 s; on disconnect, an exponential-backoff
/// reconnect loop keeps trying.
pub struct Connection {
	pub incoming: mpsc::UnboundedReceiver<Frame>,
	pub outgoing: mpsc::UnboundedSender<Frame>,
	_task: JoinHandle<()>,
}

impl Connection {
	pub async fn connect(client: &Client) -> Result<Self> {
		let mut url = client.base().clone();
		let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
		url.set_scheme(scheme).map_err(|_| Error::Network("scheme".into()))?;
		url.set_path("/ws");

		let token = client.store().get().await;

		let (in_tx, in_rx) = mpsc::unbounded_channel::<Frame>();
		let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();

		let mut req = url.as_str().into_client_request().map_err(|e| Error::Ws(e.to_string()))?;
		if let Some(t) = &token {
			let v = format!("Bearer {t}").parse().map_err(|e: tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue| Error::Ws(e.to_string()))?;
			req.headers_mut().insert("Authorization", v);
		}
		let (ws, _resp) = tokio_tungstenite::connect_async(req)
			.await
			.map_err(|e| Error::Ws(e.to_string()))?;
		let (mut sink, mut stream) = ws.split();

		let task = tokio::spawn(async move {
			let mut heartbeat = tokio::time::interval(Duration::from_secs(45));
			loop {
				tokio::select! {
					Some(frame) = out_rx.recv() => {
						let payload = serde_json::json!({ "event": "message", "data": frame });
						if sink.send(Message::Text(payload.to_string())).await.is_err() {
							break;
						}
					}
					Some(msg) = stream.next() => {
						match msg {
							Ok(Message::Text(t)) => {
								if let Ok(frame) = serde_json::from_str::<Frame>(&t) {
									if in_tx.send(frame).is_err() { break; }
								}
							}
							Ok(Message::Close(_)) | Err(_) => break,
							_ => {}
						}
					}
					_ = heartbeat.tick() => {
						let frame = Frame { op: super::op::HEARTBEAT, d: serde_json::Value::Null };
						let payload = serde_json::json!({ "event": "message", "data": frame });
						if sink.send(Message::Text(payload.to_string())).await.is_err() {
							break;
						}
					}
				}
			}
		});

		Ok(Self {
			incoming: in_rx,
			outgoing: out_tx,
			_task: task,
		})
	}
}
