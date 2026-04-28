//! Camera capture + remote video reception for desktop voice rooms.
//!
//! Mirrors the audio pipeline: nokhwa pulls raw frames out of the
//! AVFoundation / Media Foundation / V4L2 backend on a worker thread,
//! we convert each frame to I420, and push it into LiveKit's
//! `NativeVideoSource`. Remote tracks coming the other way go through
//! `NativeVideoStream` and get dispatched to the WebView as JPEG-
//! encoded `voice-video-frame` Tauri events the JS side draws onto a
//! `<canvas>`.
//!
//! The capture loop lives on a dedicated OS thread because
//! `nokhwa::Camera::frame()` is blocking and the voice service runs
//! on a `current_thread` tokio runtime that already owns cpal's
//! `!Send` audio streams. Spinning a camera thread keeps the runtime
//! free for command multiplexing.
//!
//! Mobile gates this whole module out — Android / iOS will route
//! camera frames through their platform-shell capture pipeline (the
//! same JNI / FFI bridge used for audio) in a follow-up.

#![cfg(not(any(target_os = "ios", target_os = "android")))]

use livekit::webrtc::{
	video_frame::{I420Buffer, VideoBuffer, VideoFrame, VideoRotation},
	video_source::native::NativeVideoSource,
};
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{
	ApiBackend, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType, Resolution,
};
use nokhwa::{query, Camera};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

const CAPTURE_WIDTH: u32 = 1280;
const CAPTURE_HEIGHT: u32 = 720;
const TARGET_FPS: u32 = 30;

/// Maps a `device_enum` camera id (the nokhwa index serialised as a
/// string) back to a `CameraIndex`. Falls back to index 0 on parse
/// errors so a malformed setting never leaves the user without a
/// camera.
fn parse_index(id: Option<&str>) -> CameraIndex {
	let parsed = id.and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
	CameraIndex::Index(parsed)
}

/// Looks up a `CameraIndex` by matching the nokhwa human name —
/// AVFoundation/MediaFoundation surface stable names that survive
/// reboots better than enumeration order. Falls back to numeric
/// parsing if no match is found.
fn resolve_index(id: Option<&str>) -> CameraIndex {
	let id = match id {
		Some(s) => s,
		None => return CameraIndex::Index(0),
	};
	if let Ok(cameras) = query(ApiBackend::Auto) {
		for info in &cameras {
			if info.human_name() == id || info.index().to_string() == id {
				return info.index().clone();
			}
		}
	}
	parse_index(Some(id))
}

pub struct VideoCapture {
	is_running: Arc<AtomicBool>,
	join: Mutex<Option<std::thread::JoinHandle<()>>>,
}

/// Optional local-preview side-channel — the capture thread JPEG-
/// encodes a downsampled frame periodically and pushes it through
/// `emit` so the JS layer can paint the user's own camera into a
/// self-tile. Decimated to 10 fps to keep encode cost well below the
/// libwebrtc publish path that runs at 30 fps.
///
/// `emit` is a closure rather than an `AppHandle<R>` so this module
/// stays generic over the Tauri runtime — the caller (in `voice.rs`)
/// builds the closure capturing whatever runtime its commands are
/// invoked with.
pub struct LocalPreviewSink {
	identity: String,
	emit: Box<dyn Fn(RemoteFrame) + Send + Sync>,
}

impl LocalPreviewSink {
	pub fn new(identity: String, emit: Box<dyn Fn(RemoteFrame) + Send + Sync>) -> Self {
		Self { identity, emit }
	}
}

impl VideoCapture {
	pub fn new(
		device_id: Option<&str>,
		source: NativeVideoSource,
		preview: Option<LocalPreviewSink>,
	) -> Result<Self, String> {
		let camera_index = resolve_index(device_id);

		let is_running = Arc::new(AtomicBool::new(true));
		let stop = is_running.clone();

		// Spin up a dedicated capture thread. nokhwa's `Camera::frame()`
		// is blocking; running it on the voice service's current-thread
		// runtime would stall every other command (mute toggles, leave,
		// etc.). Threading also matches our cpal pattern.
		let join = std::thread::Builder::new()
			.name(format!("syren-video-{}", camera_index))
			.spawn(move || run_capture_loop(camera_index, source, preview, stop))
			.map_err(|e| format!("spawn capture thread: {e}"))?;

		Ok(Self { is_running, join: Mutex::new(Some(join)) })
	}
}

impl Drop for VideoCapture {
	fn drop(&mut self) {
		self.is_running.store(false, Ordering::Release);
		if let Some(h) = self.join.lock().take() {
			let _ = h.join();
		}
	}
}

fn run_capture_loop(
	camera_index: CameraIndex,
	source: NativeVideoSource,
	preview: Option<LocalPreviewSink>,
	is_running: Arc<AtomicBool>,
) {
	let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
		nokhwa::utils::CameraFormat::new(
			Resolution::new(CAPTURE_WIDTH, CAPTURE_HEIGHT),
			FrameFormat::MJPEG,
			TARGET_FPS,
		),
	));

	let mut camera = match Camera::new(camera_index.clone(), requested) {
		Ok(c) => c,
		Err(e) => {
			#[cfg(debug_assertions)]
			eprintln!("[voice/video] open camera {camera_index:?} failed: {e}");
			let _ = e;
			return;
		}
	};

	let fmt = match camera.camera_format() {
		fmt => fmt,
	};
	let width = fmt.resolution().width_x;
	let height = fmt.resolution().height_y;
	let frame_format = fmt.format();

	if let Err(e) = camera.open_stream() {
		#[cfg(debug_assertions)]
		eprintln!("[voice/video] open_stream failed: {e}");
		let _ = e;
		return;
	}

	#[cfg(debug_assertions)]
	eprintln!(
		"[voice/video] capture started ({}x{} {:?} {}fps)",
		width,
		height,
		frame_format,
		fmt.frame_rate()
	);

	// Reused across frames — `I420Buffer` doesn't impl `Clone`, so we
	// hold one `VideoFrame` and mutate its buffer in place per
	// iteration. `capture_frame` takes `&VideoFrame`, no ownership
	// transfer.
	let mut frame = VideoFrame {
		rotation: VideoRotation::VideoRotation0,
		timestamp_us: 0,
		frame_metadata: None,
		buffer: I420Buffer::new(width, height),
	};
	let start = Instant::now();
	let mut frame_count: u32 = 0;
	// Local preview runs at ~10 fps (capture is 30) — the self-tile
	// just needs a recent picture, not real-time motion.
	let preview_every: u32 = 3;
	let mut rgb_buf: Vec<u8> = Vec::new();

	while is_running.load(Ordering::Acquire) {
		let buf = match camera.frame() {
			Ok(b) => b,
			Err(e) => {
				#[cfg(debug_assertions)]
				eprintln!("[voice/video] frame() error: {e}");
				let _ = e;
				continue;
			}
		};

		let raw = buf.buffer();
		if !convert_to_i420(raw, frame_format, width, height, &mut frame.buffer) {
			continue;
		}

		frame.timestamp_us = start.elapsed().as_micros() as i64;
		source.capture_frame(&frame);

		frame_count = frame_count.wrapping_add(1);
		if let Some(p) = preview.as_ref() {
			if frame_count % preview_every == 0 {
				emit_preview_frame(p, &frame.buffer, width, height, &mut rgb_buf);
			}
		}
	}

	let _ = camera.stop_stream();

	#[cfg(debug_assertions)]
	eprintln!("[voice/video] capture stopped");
}

/// Converts whatever pixel format nokhwa hands us into the I420 plane
/// layout libwebrtc wants. Returns `false` if the buffer didn't match
/// any known shape so the caller skips the frame instead of pushing
/// garbage into the encoder.
fn convert_to_i420(
	src: &[u8],
	format: FrameFormat,
	width: u32,
	height: u32,
	i420: &mut I420Buffer,
) -> bool {
	let (stride_y, stride_u, stride_v) = i420.strides();
	let (data_y, data_u, data_v) = i420.data_mut();
	match format {
		FrameFormat::YUYV => {
			let src_stride = (width * 2) as i32;
			unsafe {
				yuv_sys::rs_YUY2ToI420(
					src.as_ptr(),
					src_stride,
					data_y.as_mut_ptr(),
					stride_y as i32,
					data_u.as_mut_ptr(),
					stride_u as i32,
					data_v.as_mut_ptr(),
					stride_v as i32,
					width as i32,
					height as i32,
				);
			}
			true
		}
		FrameFormat::RAWRGB => {
			if src.len() != (width as usize * height as usize * 3) {
				return false;
			}
			unsafe {
				yuv_sys::rs_RGB24ToI420(
					src.as_ptr(),
					(width * 3) as i32,
					data_y.as_mut_ptr(),
					stride_y as i32,
					data_u.as_mut_ptr(),
					stride_u as i32,
					data_v.as_mut_ptr(),
					stride_v as i32,
					width as i32,
					height as i32,
				);
			}
			true
		}
		FrameFormat::MJPEG => {
			// libyuv's `MJPGToI420` is gated behind `HAVE_JPEG` which
			// needs libjpeg-turbo via pkg-config — not present on most
			// macOS systems. Decode through the `image` crate and feed
			// the resulting RGB buffer back through `RGB24ToI420`. This
			// is slower than the libyuv fast path but works everywhere
			// the image crate's JPEG decoder does.
			let dyn_img = match image::load_from_memory(src) {
				Ok(img) => img,
				Err(e) => {
					#[cfg(debug_assertions)]
					eprintln!("[voice/video] MJPEG decode failed: {e}");
					let _ = e;
					return false;
				}
			};
			let rgb = dyn_img.to_rgb8();
			if rgb.width() != width || rgb.height() != height {
				return false;
			}
			unsafe {
				yuv_sys::rs_RGB24ToI420(
					rgb.as_raw().as_ptr(),
					(width * 3) as i32,
					data_y.as_mut_ptr(),
					stride_y as i32,
					data_u.as_mut_ptr(),
					stride_u as i32,
					data_v.as_mut_ptr(),
					stride_v as i32,
					width as i32,
					height as i32,
				);
			}
			true
		}
		_ => false,
	}
}

/// JPEG-encodes the live capture frame and emits it as
/// `voice-video-frame` with the local user's identity so the JS layer
/// can paint the self-tile from the same canvas-based MediaStream
/// flow used for remote participants. Fails are logged + dropped —
/// preview is best-effort.
fn emit_preview_frame(
	preview: &LocalPreviewSink,
	i420: &I420Buffer,
	width: u32,
	height: u32,
	rgb_buf: &mut Vec<u8>,
) {
	use base64::{engine::general_purpose::STANDARD, Engine};
	use image::{codecs::jpeg::JpegEncoder, ColorType};

	let pixels = (width as usize) * (height as usize);
	rgb_buf.resize(pixels * 3, 0);
	let (stride_y, stride_u, stride_v) = i420.strides();
	let (data_y, data_u, data_v) = i420.data();
	let ret = unsafe {
		yuv_sys::rs_I420ToRAW(
			data_y.as_ptr(),
			stride_y as i32,
			data_u.as_ptr(),
			stride_u as i32,
			data_v.as_ptr(),
			stride_v as i32,
			rgb_buf.as_mut_ptr(),
			(width * 3) as i32,
			width as i32,
			height as i32,
		)
	};
	if ret != 0 {
		return;
	}

	let mut jpeg: Vec<u8> = Vec::with_capacity(pixels / 4);
	{
		let mut encoder = JpegEncoder::new_with_quality(&mut jpeg, 70);
		if encoder
			.encode(rgb_buf, width, height, ColorType::Rgb8.into())
			.is_err()
		{
			return;
		}
	}
	(preview.emit)(RemoteFrame {
		participant: preview.identity.clone(),
		track_sid: "local".into(),
		width,
		height,
		jpeg_b64: STANDARD.encode(&jpeg),
	});
}

// ── Remote frame export to the WebView ──────────────────────────────
//
// `forward_remote_video` runs once per subscribed remote video track,
// drains its `NativeVideoStream`, JPEG-encodes the frame, and emits it
// via `voice-video-frame`. Encoded JPEG keeps event payloads small
// enough that Tauri's JSON IPC doesn't choke at 30fps; the JS side
// blob-decodes and paints onto a `<canvas>` per participant.

use livekit::webrtc::video_stream::native::NativeVideoStream;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Serialize, Clone)]
pub struct RemoteFrame {
	pub participant: String,
	pub track_sid: String,
	pub width: u32,
	pub height: u32,
	/// Base64-encoded JPEG bytes. Tauri events serialise to JSON, so
	/// raw byte arrays would balloon the payload — JPEG keeps a typical
	/// 720p frame under ~50 KB.
	pub jpeg_b64: String,
}

pub async fn forward_remote_video<R: Runtime>(
	app: AppHandle<R>,
	participant: String,
	track_sid: String,
	mut stream: NativeVideoStream,
) {
	use base64::{engine::general_purpose::STANDARD, Engine};
	use futures::StreamExt;
	use image::{codecs::jpeg::JpegEncoder, ColorType};

	let mut rgb_buf: Vec<u8> = Vec::new();

	while let Some(frame) = stream.next().await {
		let i420 = frame.buffer.to_i420();
		let width = i420.width() as u32;
		let height = i420.height() as u32;
		let pixels = (width as usize) * (height as usize);
		rgb_buf.resize(pixels * 3, 0);

		let (stride_y, stride_u, stride_v) = i420.strides();
		let (data_y, data_u, data_v) = i420.data();

		let ret = unsafe {
			yuv_sys::rs_I420ToRAW(
				data_y.as_ptr(),
				stride_y as i32,
				data_u.as_ptr(),
				stride_u as i32,
				data_v.as_ptr(),
				stride_v as i32,
				rgb_buf.as_mut_ptr(),
				(width * 3) as i32,
				width as i32,
				height as i32,
			)
		};
		if ret != 0 {
			continue;
		}

		let mut jpeg: Vec<u8> = Vec::with_capacity(pixels / 4);
		{
			let mut encoder = JpegEncoder::new_with_quality(&mut jpeg, 70);
			if encoder
				.encode(&rgb_buf, width, height, ColorType::Rgb8.into())
				.is_err()
			{
				continue;
			}
		}

		let payload = RemoteFrame {
			participant: participant.clone(),
			track_sid: track_sid.clone(),
			width,
			height,
			jpeg_b64: STANDARD.encode(&jpeg),
		};
		let _ = app.emit("voice-video-frame", payload);
	}

	#[cfg(debug_assertions)]
	eprintln!("[voice/video] remote stream ended for {participant}/{track_sid}");
}
