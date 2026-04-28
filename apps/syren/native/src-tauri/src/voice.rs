//! Voice (LiveKit) Tauri surface.
//!
//! Wraps the Rust LiveKit SDK so the WebView can drive a voice room
//! via `invoke('voice_join', …)` instead of running `livekit-client`
//! (the JS SDK) inside the WebView. Lifecycle pattern is from
//! `livekit/rust-sdks/examples/local_audio` — `Room::connect`, publish
//! a `LocalAudioTrack` backed by a `NativeAudioSource` that cpal feeds
//! mic samples into, and on every `RoomEvent::TrackSubscribed` spawn a
//! `NativeAudioStream` task that drains remote PCM into a shared
//! `AudioMixer` cpal pulls for playback.
//!
//! Only desktop (macOS / Linux / Windows) here. Mobile gets the same
//! `Room::connect` core in a follow-up — audio capture / playback
//! moves to JNI (Android `AudioRecord` / `AudioTrack`) and FFI
//! (iOS `AVAudioEngine`) instead of cpal, but the room control flow
//! stays identical.

use futures::StreamExt;
use livekit::{
	options::TrackPublishOptions,
	track::{LocalAudioTrack, LocalTrack, RemoteTrack, TrackSource},
	webrtc::{
		audio_frame::AudioFrame,
		audio_source::native::NativeAudioSource,
		audio_stream::native::NativeAudioStream,
		prelude::{AudioSourceOptions, RtcAudioSource},
	},
	Room, RoomEvent, RoomOptions,
};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use crate::voice_audio::{AudioCapture, AudioMixer, AudioPlayback, NUM_CHANNELS, SAMPLE_RATE};

#[cfg(any(target_os = "ios", target_os = "android"))]
const SAMPLE_RATE: u32 = 48000;
#[cfg(any(target_os = "ios", target_os = "android"))]
const NUM_CHANNELS: u32 = 1;

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

/// Per-app voice state. Holds the active room (if any) plus the audio
/// pipeline so they all live for the room's lifetime and drop together
/// on leave / disconnect.
struct ActiveRoom {
	room: Arc<Room>,
	local_track: LocalAudioTrack,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	_capture: AudioCapture,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	_playback: AudioPlayback,
}

pub struct VoiceHandle {
	cmd_tx: Mutex<Option<mpsc::UnboundedSender<VoiceCommand>>>,
}

impl VoiceHandle {
	pub fn new() -> Self {
		Self { cmd_tx: Mutex::new(None) }
	}

	/// Lazily spin up the voice service task on first use. Single
	/// service across the app's lifetime so a single `Room` instance
	/// owns the libwebrtc connection and audio pipeline.
	///
	/// Runs on a dedicated OS thread with a `current_thread` tokio
	/// runtime — cpal's `Stream` is `!Send` on this build, so the
	/// service can't sit on the multi-threaded tokio runtime Tauri
	/// uses. Locality is fine here: there's exactly one voice service
	/// per app and it's not in the request hot path.
	fn ensure<R: Runtime>(&self, app: &AppHandle<R>) -> mpsc::UnboundedSender<VoiceCommand> {
		let mut guard = self.cmd_tx.lock();
		if let Some(tx) = guard.as_ref() {
			return tx.clone();
		}
		let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<VoiceCommand>();
		let app_clone = app.clone();
		std::thread::Builder::new()
			.name("syren-voice".into())
			.spawn(move || {
				let rt = tokio::runtime::Builder::new_current_thread()
					.enable_all()
					.build()
					.expect("voice runtime");
				rt.block_on(service_task(app_clone, cmd_rx));
			})
			.expect("spawn voice thread");
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
/// lifetime, multiplexes commands from JS and pushes events back via
/// `voice-event` Tauri broadcasts.
async fn service_task<R: Runtime>(
	app: AppHandle<R>,
	mut cmd_rx: mpsc::UnboundedReceiver<VoiceCommand>,
) {
	let mut active: Option<ActiveRoom> = None;

	while let Some(cmd) = cmd_rx.recv().await {
		match cmd {
			VoiceCommand::Join { url, token, channel_id } => {
				if active.is_some() {
					active = leave_active(&app, active).await;
				}
				let _ = app.emit(
					"voice-event",
					VoiceEvent::Connecting { channel_id: channel_id.clone() },
				);
				match handle_join(&app, &url, &token, &channel_id).await {
					Ok(state) => {
						let _ = app.emit(
							"voice-event",
							VoiceEvent::Connected { channel_id: channel_id.clone() },
						);
						active = Some(state);
					}
					Err(e) => {
						#[cfg(debug_assertions)]
						eprintln!("[voice] join failed: {e}");
						let _ = app.emit("voice-event", VoiceEvent::Error { message: e });
					}
				}
			}
			VoiceCommand::Leave => {
				active = leave_active(&app, active).await;
			}
			VoiceCommand::SetMicEnabled(enabled) => {
				if let Some(state) = &active {
					if enabled {
						state.local_track.unmute();
					} else {
						state.local_track.mute();
					}
				}
			}
			VoiceCommand::SetCameraEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set_camera_enabled = {enabled} (TODO: video pipeline)");
				let _ = enabled;
			}
			VoiceCommand::SetSpeakerEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set_speaker_enabled = {enabled} (handled by mixer volume; not wired)");
				let _ = enabled;
			}
		}
	}

	if active.is_some() {
		let _ = leave_active(&app, active).await;
	}
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn handle_join<R: Runtime>(
	app: &AppHandle<R>,
	url: &str,
	token: &str,
	_channel_id: &str,
) -> Result<ActiveRoom, String> {
	// `RoomOptions` is `#[non_exhaustive]`; construct then mutate.
	let mut opts = RoomOptions::default();
	opts.auto_subscribe = true;
	let (room, room_events) = Room::connect(url, token, opts)
		.await
		.map_err(|e| format!("Room::connect: {e}"))?;
	let room = Arc::new(room);

	// Mic source — cpal pushes 10ms PCM chunks into this. We pre-create
	// the source so the local track has something published immediately
	// even if the mic stream takes a moment to spin up.
	let source = NativeAudioSource::new(
		AudioSourceOptions {
			echo_cancellation: true,
			noise_suppression: true,
			auto_gain_control: true,
		},
		SAMPLE_RATE,
		NUM_CHANNELS,
		1000, // 1 second internal buffer
	);

	// Mic capture: cpal callback → mpsc → 10ms framing → NativeAudioSource.
	let (mic_tx, mic_rx) = mpsc::unbounded_channel::<Vec<i16>>();
	let capture = AudioCapture::new(mic_tx).map_err(|e| format!("audio capture: {e}"))?;
	tokio::spawn(forward_mic_to_livekit(mic_rx, source.clone()));

	// Mixer + playback: each remote audio track will append into this.
	let mixer = AudioMixer::new(1.0);
	let playback = AudioPlayback::new(mixer.clone()).map_err(|e| format!("audio playback: {e}"))?;

	// Publish the local mic track.
	let track =
		LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source));
	room.local_participant()
		.publish_track(
			LocalTrack::Audio(track.clone()),
			TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() },
		)
		.await
		.map_err(|e| format!("publish mic: {e}"))?;

	// Forward `RoomEvent`s to the JS side and feed remote audio into
	// the mixer.
	let app_for_events = app.clone();
	let mixer_for_events = mixer.clone();
	tokio::spawn(forward_room_events(
		room.clone(),
		room_events,
		app_for_events,
		mixer_for_events,
	));

	Ok(ActiveRoom {
		room,
		local_track: track,
		_capture: capture,
		_playback: playback,
	})
}

#[cfg(any(target_os = "ios", target_os = "android"))]
async fn handle_join<R: Runtime>(
	_app: &AppHandle<R>,
	_url: &str,
	_token: &str,
	_channel_id: &str,
) -> Result<ActiveRoom, String> {
	Err("voice not implemented on this platform yet".into())
}

async fn leave_active<R: Runtime>(
	app: &AppHandle<R>,
	active: Option<ActiveRoom>,
) -> Option<ActiveRoom> {
	if let Some(state) = active {
		// Closing the room ends the SDK's internal task, which closes
		// the event stream that `forward_room_events` is reading; that
		// task exits and its captured mixer/etc. drop. The local track
		// + capture/playback drop with `state` going out of scope.
		let _ = state.room.close().await;
		let _ = app.emit(
			"voice-event",
			VoiceEvent::Disconnected { reason: Some("user_left".into()) },
		);
		drop(state);
	}
	None
}

/// Pulls 10ms-aligned PCM out of the cpal capture mpsc and pushes it
/// into LiveKit's `NativeAudioSource`. cpal callbacks land
/// device-buffer-sized chunks (often not multiples of 10ms), so we
/// buffer + slice here to match the source's expected frame size.
async fn forward_mic_to_livekit(
	mut rx: mpsc::UnboundedReceiver<Vec<i16>>,
	source: NativeAudioSource,
) {
	let samples_per_10ms = (SAMPLE_RATE / 100) as usize;
	let mut buffer: Vec<i16> = Vec::with_capacity(samples_per_10ms * 4);
	while let Some(chunk) = rx.recv().await {
		buffer.extend_from_slice(&chunk);
		while buffer.len() >= samples_per_10ms {
			let frame: Vec<i16> = buffer.drain(..samples_per_10ms).collect();
			let af = AudioFrame {
				data: frame.into(),
				sample_rate: SAMPLE_RATE,
				num_channels: NUM_CHANNELS,
				samples_per_channel: samples_per_10ms as u32,
			};
			if let Err(e) = source.capture_frame(&af).await {
				#[cfg(debug_assertions)]
				eprintln!("[voice] capture_frame failed: {e}");
				let _ = e;
				break;
			}
		}
	}
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn forward_room_events<R: Runtime>(
	_room: Arc<Room>,
	mut events: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
	app: AppHandle<R>,
	mixer: AudioMixer,
) {
	while let Some(event) = events.recv().await {
		match event {
			RoomEvent::ParticipantConnected(p) => {
				let _ = app.emit(
					"voice-event",
					VoiceEvent::ParticipantJoined { identity: p.identity().to_string() },
				);
			}
			RoomEvent::ParticipantDisconnected(p) => {
				let _ = app.emit(
					"voice-event",
					VoiceEvent::ParticipantLeft { identity: p.identity().to_string() },
				);
			}
			RoomEvent::TrackSubscribed { track, participant, .. } => {
				let kind = format!("{:?}", track.kind()).to_lowercase();
				let _ = app.emit(
					"voice-event",
					VoiceEvent::TrackSubscribed {
						participant: participant.identity().to_string(),
						track_kind: kind,
					},
				);
				if let RemoteTrack::Audio(audio_track) = track {
					let mixer_clone = mixer.clone();
					let mut stream = NativeAudioStream::new(
						audio_track.rtc_track(),
						SAMPLE_RATE as i32,
						NUM_CHANNELS as i32,
					);
					tokio::spawn(async move {
						while let Some(frame) = stream.next().await {
							mixer_clone.add_audio_data(frame.data.as_ref());
						}
					});
				}
			}
			RoomEvent::TrackUnsubscribed { track, participant, .. } => {
				let kind = format!("{:?}", track.kind()).to_lowercase();
				let _ = app.emit(
					"voice-event",
					VoiceEvent::TrackUnsubscribed {
						participant: participant.identity().to_string(),
						track_kind: kind,
					},
				);
			}
			RoomEvent::Disconnected { reason } => {
				let _ = app.emit(
					"voice-event",
					VoiceEvent::Disconnected { reason: Some(format!("{reason:?}")) },
				);
				break;
			}
			_ => {
				// Other events (TrackPublished, ConnectionQuality, etc.) — not
				// surfaced yet; add as the UI grows.
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
