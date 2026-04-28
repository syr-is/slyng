//! Voice (LiveKit) Tauri surface.
//!
//! Wraps the Rust LiveKit SDK so the WebView can drive a voice room
//! via `invoke('voice_join', …)` / `voice-event` Tauri events instead
//! of running `livekit-client` (the JS SDK) inside the WebView. The
//! room lifecycle is identical to LiveKit's `examples/wgpu_room`
//! pattern — command channel in, event channel out — but the UI side
//! lives in the WebView, so audio I/O attaches to platform-native
//! capture / playback (cpal on desktop, JNI / FFI on mobile) and
//! video frames are streamed to the WebView for `<canvas>` rendering.
//!
//! This is the **Phase 10 step 1 scaffold** — Tauri commands compile
//! and round-trip; the actual `Room::connect`, audio I/O, and
//! video-frame plumbing land in follow-up commits so we can verify
//! the libwebrtc build + linker setup before committing to the bigger
//! integration.

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;

#[derive(Debug)]
pub enum VoiceCommand {
	Join { url: String, token: String, channel_id: String },
	Leave,
	SetMicEnabled(bool),
	SetCameraEnabled(bool),
	SetSpeakerEnabled(bool),
}

/// One serialised event payload for the JS side. Each variant maps to
/// a distinct `voice-event` shape the WebView listens for and folds
/// into `voice-state.svelte.ts`.
///
/// Tag key is `event` (not `kind`) because the track-subscription
/// variants already carry a `track_kind` field — internally-tagged
/// enums require the discriminator name to not collide with any
/// variant field.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum VoiceEvent {
	Connecting { channel_id: String },
	Connected { channel_id: String },
	Disconnected { reason: Option<String> },
	ParticipantJoined { identity: String },
	ParticipantLeft { identity: String },
	TrackSubscribed { participant: String, track_kind: String },
	TrackUnsubscribed { participant: String, track_kind: String },
	Error { message: String },
}

pub struct VoiceHandle {
	cmd_tx: Mutex<Option<mpsc::UnboundedSender<VoiceCommand>>>,
}

impl VoiceHandle {
	pub fn new() -> Self {
		Self { cmd_tx: Mutex::new(None) }
	}

	/// Lazily spin up the voice service task on first use. Reuses the
	/// existing service across calls so a single `Room` instance owns
	/// the libwebrtc connection for the app's lifetime.
	fn ensure<R: Runtime>(&self, app: &AppHandle<R>) -> mpsc::UnboundedSender<VoiceCommand> {
		let mut guard = self.cmd_tx.lock();
		if let Some(tx) = guard.as_ref() {
			return tx.clone();
		}
		let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<VoiceCommand>();
		let app_clone = app.clone();
		tokio::spawn(service_task(app_clone, cmd_rx));
		*guard = Some(cmd_tx.clone());
		cmd_tx
	}
}

impl Default for VoiceHandle {
	fn default() -> Self {
		Self::new()
	}
}

/// The voice service task. Owns the LiveKit `Room` for the app
/// lifetime, multiplexes commands from JS and events back to JS via
/// `voice-event` Tauri events.
///
/// **Scaffold version**: handles the command stream and forwards
/// events. Actual `Room::connect` + audio / video pipelines land in
/// the follow-up commit.
async fn service_task<R: Runtime>(
	app: AppHandle<R>,
	mut cmd_rx: mpsc::UnboundedReceiver<VoiceCommand>,
) {
	let _connected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

	while let Some(cmd) = cmd_rx.recv().await {
		match cmd {
			VoiceCommand::Join { url: _, token: _, channel_id } => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] join requested for channel {channel_id}");
				let _ = app.emit("voice-event", VoiceEvent::Connecting { channel_id: channel_id.clone() });
				// TODO(phase-10/step-2): construct livekit::Room::connect,
				// publish a NativeAudioSource backed by cpal (desktop) or
				// platform-pushed PCM (mobile), forward `RoomEvent`s here
				// as the matching VoiceEvent variants.
				let _ = app.emit(
					"voice-event",
					VoiceEvent::Error {
						message: "voice not implemented yet (Phase 10 step 1 scaffold)".into(),
					},
				);
			}
			VoiceCommand::Leave => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] leave requested");
				let _ = app.emit("voice-event", VoiceEvent::Disconnected { reason: None });
			}
			VoiceCommand::SetMicEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set mic enabled = {enabled}");
			}
			VoiceCommand::SetCameraEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set camera enabled = {enabled}");
			}
			VoiceCommand::SetSpeakerEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set speaker enabled = {enabled}");
			}
		}
	}
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn voice_join<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, VoiceHandle>,
	url: String,
	token: String,
	channel_id: String,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::Join { url, token, channel_id })
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_leave<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, VoiceHandle>,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::Leave).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_mic<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, VoiceHandle>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetMicEnabled(enabled))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_camera<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, VoiceHandle>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetCameraEnabled(enabled))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_speaker<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, VoiceHandle>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetSpeakerEnabled(enabled))
		.map_err(|e| e.to_string())
}
