//! Tauri-side Realtime (WS) glue. One process-wide `RealtimeClient`
//! instance keyed by API host. Incoming frames are emitted as
//! `realtime-frame` Tauri events; state transitions as `realtime-state`.
//! JS subscribes via `listen('realtime-frame', …)` from
//! `ws.svelte.ts` and dispatches by op locally.

use crate::auth::ClientHandle;
use serde_json::Value;
use syren_client::{Frame, RealtimeClient, WsState};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::Mutex;

pub struct RealtimeHandle {
	inner: Mutex<Option<RealtimeClient>>,
}

impl RealtimeHandle {
	pub fn new() -> Self {
		Self {
			inner: Mutex::new(None),
		}
	}

	async fn ensure<R: Runtime>(
		&self,
		app: &AppHandle<R>,
		api_host: &str,
	) -> Result<RealtimeClient, String> {
		// Build via the existing `ClientHandle` so the realtime client
		// shares its session store with the HTTP client — IDENTIFY
		// always carries the bearer the API layer is using.
		let state: State<'_, ClientHandle> = app.state();
		let api_client = state.ensure(app, api_host).await?;

		let mut guard = self.inner.lock().await;
		if let Some(rt) = guard.as_ref() {
			return Ok(rt.clone());
		}
		let rt = RealtimeClient::from_client(&api_client);

		// Wire the frame + state callbacks to Tauri events. These are
		// installed once per RealtimeClient lifetime.
		let app_emit = app.clone();
		rt.on_frame(move |frame: Frame| {
			let payload = serde_json::json!({
				"op": frame.op,
				"d": frame.d,
			});
			let _ = app_emit.emit("realtime-frame", payload);
		});
		let app_state = app.clone();
		rt.on_state(move |state: WsState| {
			let s = match state {
				WsState::Disconnected => "disconnected",
				WsState::Connecting => "connecting",
				WsState::Connected => "connected",
				WsState::Identified => "identified",
			};
			let _ = app_state.emit("realtime-state", s);
		});

		*guard = Some(rt.clone());
		Ok(rt)
	}
}

#[tauri::command]
pub async fn realtime_connect<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.connect().await;
	Ok(())
}

#[tauri::command]
pub async fn realtime_disconnect<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.disconnect().await;
	Ok(())
}

#[tauri::command]
pub async fn realtime_send<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
	op: u32,
	d: Value,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.send(op, d).await;
	Ok(())
}

#[tauri::command]
pub async fn realtime_subscribe_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
	channel_ids: Vec<String>,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.subscribe_channels(channel_ids).await;
	Ok(())
}

#[tauri::command]
pub async fn realtime_unsubscribe_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
	channel_ids: Vec<String>,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.unsubscribe_channels(channel_ids).await;
	Ok(())
}

#[tauri::command]
pub async fn realtime_send_typing<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, RealtimeHandle>,
	api_host: String,
	channel_id: String,
) -> Result<(), String> {
	let rt = state.ensure(&app, &api_host).await?;
	rt.send_typing(&channel_id).await;
	Ok(())
}
