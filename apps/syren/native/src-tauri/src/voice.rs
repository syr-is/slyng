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

use livekit::{
	options::TrackPublishOptions,
	track::{LocalAudioTrack, LocalTrack, LocalVideoTrack, RemoteTrack, TrackSource},
	webrtc::{
		audio_frame::AudioFrame,
		audio_source::native::NativeAudioSource,
		audio_stream::native::NativeAudioStream,
		prelude::{AudioSourceOptions, RtcAudioSource, RtcVideoSource},
		video_source::native::NativeVideoSource,
		video_source::VideoResolution,
		video_stream::native::NativeVideoStream,
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
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use crate::voice_video::{forward_remote_video, VideoCapture};

#[cfg(any(target_os = "ios", target_os = "android"))]
const SAMPLE_RATE: u32 = 48000;
#[cfg(any(target_os = "ios", target_os = "android"))]
const NUM_CHANNELS: u32 = 1;

#[derive(Debug)]
pub enum VoiceCommand {
	Join { url: String, token: String, channel_id: String, self_identity: String },
	Leave,
	SetMicEnabled(bool),
	SetCameraEnabled(bool),
	SetSpeakerEnabled(bool),
	/// `None` falls back to the cpal default device. The chosen device
	/// also gets persisted on `VoiceHandle::pref_input` so the next
	/// `Join` builds capture against it from the start.
	SetInputDevice(Option<String>),
	SetOutputDevice(Option<String>),
	SetCameraDevice(Option<String>),
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
	/// Identity the local participant joins under — passed by JS when
	/// `voice_join` is invoked and reused for the local self-preview
	/// `voice-video-frame` emit so the UI can route those frames into
	/// the same per-participant canvas as remote frames.
	self_identity: String,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	source: NativeAudioSource,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	mixer: AudioMixer,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	capture: Option<AudioCapture>,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	playback: Option<AudioPlayback>,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	mic_forward: Option<tokio::task::JoinHandle<()>>,
	// ── Video pipeline ──────────────────────────────────────────────
	//
	// Video gets a long-lived `NativeVideoSource` + `LocalVideoTrack`
	// that we publish on the first `SetCameraEnabled(true)` and keep
	// alive for the room's lifetime. The actual capture (nokhwa
	// thread) lives in `video_capture` and is created / dropped as the
	// camera toggles, so disabled = no camera-on indicator on remote
	// participants but the published track stays valid for re-enable.
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	video_source: NativeVideoSource,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	video_track: LocalVideoTrack,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	video_capture: Option<VideoCapture>,
	#[cfg(not(any(target_os = "ios", target_os = "android")))]
	video_published: bool,
}

pub struct VoiceHandle {
	cmd_tx: Mutex<Option<mpsc::UnboundedSender<VoiceCommand>>>,
	/// User's selected devices, persisted across calls. The
	/// service-task reads these on `Join` so the cpal pipeline starts
	/// against the user's pick instead of the system default. JS can
	/// also flip them outside a call (settings tab) and the next join
	/// honours it.
	pref_input: Mutex<Option<String>>,
	pref_output: Mutex<Option<String>>,
	#[allow(dead_code)] // Camera publish pipeline lands later.
	pref_camera: Mutex<Option<String>>,
}

impl VoiceHandle {
	pub fn new() -> Self {
		Self {
			cmd_tx: Mutex::new(None),
			pref_input: Mutex::new(None),
			pref_output: Mutex::new(None),
			pref_camera: Mutex::new(None),
		}
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
	fn ensure<R: Runtime>(
		self: &Arc<Self>,
		app: &AppHandle<R>,
	) -> mpsc::UnboundedSender<VoiceCommand> {
		let mut guard = self.cmd_tx.lock();
		if let Some(tx) = guard.as_ref() {
			return tx.clone();
		}
		let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<VoiceCommand>();
		let app_clone = app.clone();
		let handle_clone = Arc::clone(self);
		std::thread::Builder::new()
			.name("syren-voice".into())
			.spawn(move || {
				let rt = tokio::runtime::Builder::new_current_thread()
					.enable_all()
					.build()
					.expect("voice runtime");
				rt.block_on(service_task(app_clone, handle_clone, cmd_rx));
			})
			.expect("spawn voice thread");
		*guard = Some(cmd_tx.clone());
		cmd_tx
	}

	pub fn set_pref_input(&self, id: Option<String>) {
		*self.pref_input.lock() = id;
	}
	pub fn set_pref_output(&self, id: Option<String>) {
		*self.pref_output.lock() = id;
	}
	pub fn set_pref_camera(&self, id: Option<String>) {
		*self.pref_camera.lock() = id;
	}
	pub fn pref_input(&self) -> Option<String> {
		self.pref_input.lock().clone()
	}
	pub fn pref_output(&self) -> Option<String> {
		self.pref_output.lock().clone()
	}
	pub fn pref_camera(&self) -> Option<String> {
		self.pref_camera.lock().clone()
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
	handle: Arc<VoiceHandle>,
	mut cmd_rx: mpsc::UnboundedReceiver<VoiceCommand>,
) {
	let mut active: Option<ActiveRoom> = None;

	while let Some(cmd) = cmd_rx.recv().await {
		match cmd {
			VoiceCommand::Join { url, token, channel_id, self_identity } => {
				if active.is_some() {
					active = leave_active(&app, active).await;
				}
				let _ = app.emit(
					"voice-event",
					VoiceEvent::Connecting { channel_id: channel_id.clone() },
				);
				let pref_in = handle.pref_input();
				let pref_out = handle.pref_output();
				match handle_join(
					&app,
					&url,
					&token,
					&channel_id,
					&self_identity,
					pref_in.as_deref(),
					pref_out.as_deref(),
				)
				.await
				{
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
				#[cfg(not(any(target_os = "ios", target_os = "android")))]
				if let Some(state) = active.as_mut() {
					if let Err(e) = set_camera_enabled(&app, state, enabled, handle.pref_camera()).await {
						let _ = app.emit("voice-event", VoiceEvent::Error { message: e });
					}
				}
				#[cfg(any(target_os = "ios", target_os = "android"))]
				let _ = enabled;
			}
			VoiceCommand::SetSpeakerEnabled(enabled) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice] set_speaker_enabled = {enabled} (handled by mixer volume; not wired)");
				let _ = enabled;
			}
			VoiceCommand::SetInputDevice(id) => {
				handle.set_pref_input(id.clone());
				#[cfg(not(any(target_os = "ios", target_os = "android")))]
				if let Some(state) = active.as_mut() {
					if let Err(e) = swap_input(state, id.as_deref()) {
						let _ = app.emit("voice-event", VoiceEvent::Error { message: e });
					}
				}
			}
			VoiceCommand::SetOutputDevice(id) => {
				handle.set_pref_output(id.clone());
				#[cfg(not(any(target_os = "ios", target_os = "android")))]
				if let Some(state) = active.as_mut() {
					if let Err(e) = swap_output(state, id.as_deref()) {
						let _ = app.emit("voice-event", VoiceEvent::Error { message: e });
					}
				}
			}
			VoiceCommand::SetCameraDevice(id) => {
				handle.set_pref_camera(id.clone());
				#[cfg(not(any(target_os = "ios", target_os = "android")))]
				if let Some(state) = active.as_mut() {
					if state.video_capture.is_some() {
						if let Err(e) = swap_camera(&app, state, id.as_deref()) {
							let _ = app.emit("voice-event", VoiceEvent::Error { message: e });
						}
					}
				}
			}
		}
	}

	if active.is_some() {
		let _ = leave_active(&app, active).await;
	}
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn swap_input(state: &mut ActiveRoom, id: Option<&str>) -> Result<(), String> {
	// Drop the existing capture + forward task before building the new
	// stream so cpal can release the previous device cleanly.
	state.capture.take();
	if let Some(h) = state.mic_forward.take() {
		h.abort();
	}
	let (tx, rx) = mpsc::unbounded_channel::<Vec<i16>>();
	let capture = AudioCapture::new(tx, id)?;
	let forward = tokio::spawn(forward_mic_to_livekit(rx, state.source.clone()));
	state.capture = Some(capture);
	state.mic_forward = Some(forward);
	Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn swap_output(state: &mut ActiveRoom, id: Option<&str>) -> Result<(), String> {
	state.playback.take();
	let playback = AudioPlayback::new(state.mixer.clone(), id)?;
	state.playback = Some(playback);
	Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn set_camera_enabled<R: Runtime>(
	app: &AppHandle<R>,
	state: &mut ActiveRoom,
	enabled: bool,
	pref: Option<String>,
) -> Result<(), String> {
	if enabled {
		// Lazy-publish on first enable so room participants don't see a
		// dead camera track for users who never turn theirs on.
		if !state.video_published {
			state
				.room
				.local_participant()
				.publish_track(
					LocalTrack::Video(state.video_track.clone()),
					TrackPublishOptions { source: TrackSource::Camera, ..Default::default() },
				)
				.await
				.map_err(|e| format!("publish video: {e}"))?;
			state.video_published = true;
		}
		state.video_track.unmute();
		if state.video_capture.is_none() {
			let preview = build_preview_sink(app, &state.self_identity);
			state.video_capture = Some(VideoCapture::new(
				pref.as_deref(),
				state.video_source.clone(),
				Some(preview),
			)?);
		}
	} else {
		state.video_capture.take();
		state.video_track.mute();
	}
	Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn swap_camera<R: Runtime>(
	app: &AppHandle<R>,
	state: &mut ActiveRoom,
	id: Option<&str>,
) -> Result<(), String> {
	state.video_capture.take();
	let preview = build_preview_sink(app, &state.self_identity);
	state.video_capture = Some(VideoCapture::new(
		id,
		state.video_source.clone(),
		Some(preview),
	)?);
	Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn build_preview_sink<R: Runtime>(
	app: &AppHandle<R>,
	identity: &str,
) -> crate::voice_video::LocalPreviewSink {
	let app_clone = app.clone();
	crate::voice_video::LocalPreviewSink::new(
		identity.to_string(),
		Box::new(move |frame| {
			let _ = app_clone.emit("voice-video-frame", frame);
		}),
	)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn handle_join<R: Runtime>(
	app: &AppHandle<R>,
	url: &str,
	token: &str,
	_channel_id: &str,
	self_identity: &str,
	pref_input: Option<&str>,
	pref_output: Option<&str>,
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
	let capture = AudioCapture::new(mic_tx, pref_input)
		.map_err(|e| format!("audio capture: {e}"))?;
	let mic_forward = tokio::spawn(forward_mic_to_livekit(mic_rx, source.clone()));

	// Mixer + playback: each remote audio track will append into this.
	let mixer = AudioMixer::new(1.0);
	let playback = AudioPlayback::new(mixer.clone(), pref_output)
		.map_err(|e| format!("audio playback: {e}"))?;

	// Publish the local mic track.
	let track =
		LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source.clone()));
	room.local_participant()
		.publish_track(
			LocalTrack::Audio(track.clone()),
			TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() },
		)
		.await
		.map_err(|e| format!("publish mic: {e}"))?;

	// Local camera scaffolding. Source + track exist for the room's
	// life so any future camera-on toggle just unmutes; we only build
	// the capture thread (and publish) on the first enable so users
	// who never turn the camera on don't show a dead track.
	let video_source = NativeVideoSource::new(
		VideoResolution { width: 1280, height: 720 },
		false, // not a screen-share source
	);
	let video_track = LocalVideoTrack::create_video_track(
		"camera",
		RtcVideoSource::Native(video_source.clone()),
	);
	video_track.mute();

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
		self_identity: self_identity.to_string(),
		source,
		mixer,
		capture: Some(capture),
		playback: Some(playback),
		mic_forward: Some(mic_forward),
		video_source,
		video_track,
		video_capture: None,
		video_published: false,
	})
}

#[cfg(any(target_os = "ios", target_os = "android"))]
async fn handle_join<R: Runtime>(
	_app: &AppHandle<R>,
	_url: &str,
	_token: &str,
	_channel_id: &str,
	self_identity: &str,
	_pref_input: Option<&str>,
	_pref_output: Option<&str>,
) -> Result<ActiveRoom, String> {
	let _ = self_identity;
	Err("voice not implemented on this platform yet".into())
}

async fn leave_active<R: Runtime>(
	app: &AppHandle<R>,
	active: Option<ActiveRoom>,
) -> Option<ActiveRoom> {
	if let Some(mut state) = active {
		#[cfg(not(any(target_os = "ios", target_os = "android")))]
		{
			if let Some(h) = state.mic_forward.take() {
				h.abort();
			}
		}
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
			RoomEvent::TrackSubscribed { track, participant, publication } => {
				let kind = format!("{:?}", track.kind()).to_lowercase();
				let _ = app.emit(
					"voice-event",
					VoiceEvent::TrackSubscribed {
						participant: participant.identity().to_string(),
						track_kind: kind,
					},
				);
				match track {
					RemoteTrack::Audio(audio_track) => {
						let mixer_clone = mixer.clone();
						let mut stream = NativeAudioStream::new(
							audio_track.rtc_track(),
							SAMPLE_RATE as i32,
							NUM_CHANNELS as i32,
						);
						tokio::spawn(async move {
							use futures::StreamExt;
							while let Some(frame) = stream.next().await {
								mixer_clone.add_audio_data(frame.data.as_ref());
							}
						});
					}
					RemoteTrack::Video(video_track) => {
						let stream = NativeVideoStream::new(video_track.rtc_track());
						tokio::spawn(forward_remote_video(
							app.clone(),
							participant.identity().to_string(),
							publication.sid().to_string(),
							stream,
						));
					}
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
	state: State<'_, Arc<VoiceHandle>>,
	url: String,
	token: String,
	channel_id: String,
	self_identity: String,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::Join { url, token, channel_id, self_identity })
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_leave<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::Leave).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_mic<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetMicEnabled(enabled))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_camera<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetCameraEnabled(enabled))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_speaker<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	enabled: bool,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetSpeakerEnabled(enabled))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_input_device<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	device_id: Option<String>,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetInputDevice(device_id))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_output_device<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	device_id: Option<String>,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetOutputDevice(device_id))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_set_camera_device<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, Arc<VoiceHandle>>,
	device_id: Option<String>,
) -> Result<(), String> {
	let tx = state.ensure(&app);
	tx.send(VoiceCommand::SetCameraDevice(device_id))
		.map_err(|e| e.to_string())
}
