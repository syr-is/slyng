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
	ApiBackend, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
};
use nokhwa::{query, Camera};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

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

/// Tries to re-request the camera at the user's chosen framerate
/// while preserving the resolution + pixel format `Camera::new` just
/// negotiated. nokhwa expects an `Exact(CameraFormat)` and only
/// honours rates the camera advertises for that res+format pair, so
/// we skip when the user picked something the camera doesn't list
/// (rather than letting the request error and leave the camera
/// closed). `target_fps == None` means "leave whatever
/// `AbsoluteHighestResolution` already chose alone."
fn apply_fps_preference(camera: &mut Camera, target_fps: Option<u32>) {
	let Some(target) = target_fps else { return };
	let current = camera.camera_format();
	if current.frame_rate() == target {
		return;
	}

	let supports = camera
		.compatible_camera_formats()
		.map(|formats| {
			formats.into_iter().any(|f| {
				f.resolution() == current.resolution()
					&& f.format() == current.format()
					&& f.frame_rate() == target
			})
		})
		.unwrap_or(false);

	if !supports {
		eprintln!(
			"[voice/video] camera doesn't support {} fps at {}x{} {:?}; keeping {} fps",
			target,
			current.resolution().width_x,
			current.resolution().height_y,
			current.format(),
			current.frame_rate()
		);
		return;
	}

	let wanted = nokhwa::utils::CameraFormat::new(current.resolution(), current.format(), target);
	if let Err(e) =
		camera.set_camera_requset(RequestedFormat::new::<RgbFormat>(RequestedFormatType::Exact(wanted)))
	{
		eprintln!("[voice/video] set fps={target} failed: {e}");
	}
}

/// Inspects the camera's `compatible_camera_formats()` and reports the
/// highest fps supported at the highest resolution it offers — that's
/// the ceiling we expose in the Settings UI's framerate dropdown.
/// Opens + drops the camera handle in the process; if the camera is
/// already in use elsewhere this errors out, which is fine because
/// the only call sites are pre-call (Settings tab opens before voice
/// join) where nothing else holds the device.
pub fn camera_max_fps(device_id: Option<&str>) -> Result<u32, String> {
	let camera_index = resolve_index(device_id);
	let requested =
		RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestResolution);
	let mut camera = Camera::new(camera_index, requested)
		.map_err(|e| format!("open camera for capability probe: {e}"))?;
	let target_res = camera.camera_format().resolution();
	let formats = camera
		.compatible_camera_formats()
		.map_err(|e| format!("query camera formats: {e}"))?;
	let max = formats
		.into_iter()
		.filter(|f| f.resolution() == target_res)
		.map(|f| f.frame_rate())
		.max()
		.unwrap_or(30);
	Ok(max)
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
		fps: Option<u32>,
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
			.spawn(move || run_capture_loop(camera_index, source, preview, fps, stop))
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
	target_fps: Option<u32>,
	is_running: Arc<AtomicBool>,
) {
	// `Closest(MJPEG, …)` filters to MJPEG-supporting formats first;
	// macOS AVFoundation cameras don't surface MJPEG, so the request
	// fails outright. `AbsoluteHighestResolution` ranges over every
	// format in `RgbFormat::FORMATS` (MJPEG, YUYV, NV12, RAWRGB,
	// RAWBGR) and picks whichever shape the camera natively supports
	// at its top resolution — `convert_to_i420` handles the actual
	// pixel layout.
	let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestResolution);

	let mut camera = match Camera::new(camera_index.clone(), requested) {
		Ok(c) => c,
		Err(e) => {
			eprintln!("[voice/video] open camera {camera_index:?} failed: {e}");
			return;
		}
	};

	apply_fps_preference(&mut camera, target_fps);

	let fmt = camera.camera_format();
	let width = fmt.resolution().width_x;
	let height = fmt.resolution().height_y;
	let frame_format = fmt.format();

	if let Err(e) = camera.open_stream() {
		eprintln!("[voice/video] open_stream failed: {e}");
		return;
	}

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
	let mut rgb_buf: Vec<u8> = Vec::new();
	// Local self-preview runs at ~10 fps regardless of capture rate —
	// the self-tile just needs a recent picture, not real-time motion,
	// and decoupling preview cadence from capture rate keeps the
	// publish path running at its full target fps even at 60 fps
	// capture.
	let preview_interval = std::time::Duration::from_millis(100);
	let mut last_preview_at: Option<Instant> = None;

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

		if let Some(p) = preview.as_ref() {
			let now = Instant::now();
			let due = match last_preview_at {
				Some(t) => now.duration_since(t) >= preview_interval,
				None => true,
			};
			if due {
				emit_preview_frame(p, &frame.buffer, width, height, &mut rgb_buf);
				last_preview_at = Some(now);
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
///
/// macOS nokhwa-bindings aliases NV12 (`420YpCbCr8BiPlanarVideoRange`)
/// to `FrameFormat::YUYV`, so the YUYV branch here disambiguates by
/// buffer length before picking a libyuv conversion. Without this the
/// frames are silently mangled (NV12 bytes interpreted as packed 4:2:2)
/// and you'd see a green / scrambled stream on the receiver instead of
/// nothing — but we'd rather skip an unidentifiable buffer than push
/// garbage.
fn convert_to_i420(
	src: &[u8],
	format: FrameFormat,
	width: u32,
	height: u32,
	i420: &mut I420Buffer,
) -> bool {
	let (stride_y, stride_u, stride_v) = i420.strides();
	let (data_y, data_u, data_v) = i420.data_mut();
	let yuyv_size = (width as usize) * (height as usize) * 2;
	let nv12_size = (width as usize) * (height as usize) * 3 / 2;

	match format {
		FrameFormat::YUYV => {
			if src.len() == yuyv_size {
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
				return true;
			}
			if src.len() == nv12_size {
				return convert_nv12(src, width, height, data_y, stride_y, data_u, stride_u, data_v, stride_v);
			}
			eprintln!(
				"[voice/video] unrecognised YUYV-tagged buffer (len={}, expected yuyv={} or nv12={})",
				src.len(),
				yuyv_size,
				nv12_size
			);
			false
		}
		FrameFormat::NV12 => {
			if src.len() != nv12_size {
				eprintln!("[voice/video] NV12 buffer wrong size {} expected {}", src.len(), nv12_size);
				return false;
			}
			convert_nv12(src, width, height, data_y, stride_y, data_u, stride_u, data_v, stride_v)
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
		FrameFormat::RAWBGR => {
			if src.len() != (width as usize * height as usize * 3) {
				return false;
			}
			unsafe {
				yuv_sys::rs_RAWToI420(
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
					eprintln!("[voice/video] MJPEG decode failed: {e}");
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
		_ => {
			eprintln!("[voice/video] unsupported frame format {format:?}");
			false
		}
	}
}

#[allow(clippy::too_many_arguments)]
fn convert_nv12(
	src: &[u8],
	width: u32,
	height: u32,
	data_y: &mut [u8],
	stride_y: u32,
	data_u: &mut [u8],
	stride_u: u32,
	data_v: &mut [u8],
	stride_v: u32,
) -> bool {
	let y_plane_size = (width as usize) * (height as usize);
	let (src_y, src_uv) = src.split_at(y_plane_size);
	unsafe {
		yuv_sys::rs_NV12ToI420(
			src_y.as_ptr(),
			width as i32,
			src_uv.as_ptr(),
			width as i32,
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

	if !i420_to_rgb(i420, width, height, rgb_buf) {
		return;
	}
	let Some(jpeg) = encode_jpeg_rgb(rgb_buf, width, height, PREVIEW_QUALITY) else {
		return;
	};
	(preview.emit)(RemoteFrame {
		participant: preview.identity.clone(),
		track_sid: "local".into(),
		width,
		height,
		jpeg_b64: STANDARD.encode(&jpeg),
	});
}

/// Per-call JPEG quality for the local-preview + remote-display side
/// channel. 60 is visually indistinguishable from 70 for chat tiles
/// and shaves a meaningful slice of encode time.
const PREVIEW_QUALITY: f32 = 60.0;

/// libyuv-backed I420 → packed RGB24 conversion. Reuses `dst` so the
/// caller can avoid a per-frame allocation.
fn i420_to_rgb(i420: &I420Buffer, width: u32, height: u32, dst: &mut Vec<u8>) -> bool {
	let pixels = (width as usize) * (height as usize);
	dst.resize(pixels * 3, 0);
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
			dst.as_mut_ptr(),
			(width * 3) as i32,
			width as i32,
			height as i32,
		)
	};
	ret == 0
}

/// SIMD JPEG encoding via mozjpeg (libjpeg-turbo). The pure-Rust
/// `image::codecs::jpeg::JpegEncoder` was the chopiness bottleneck
/// — it sat around 30-50 ms per 720p frame and starved the capture
/// loop; mozjpeg drops that to ~3-5 ms.
fn encode_jpeg_rgb(rgb: &[u8], width: u32, height: u32, quality: f32) -> Option<Vec<u8>> {
	let mut cinfo = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
	cinfo.set_size(width as usize, height as usize);
	cinfo.set_quality(quality);
	let mut started = cinfo.start_compress(Vec::with_capacity((width * height) as usize)).ok()?;
	started.write_scanlines(rgb).ok()?;
	started.finish().ok()
}

// ── Standalone Settings preview ─────────────────────────────────────
//
// Settings → Video shows a live preview before the user joins voice.
// The voice room owns the camera while a call is active, so this
// preview is only meaningful pre-call — opening the same camera in
// two places at once fails on every platform. The Tauri commands
// `voice_preview_start` / `voice_preview_stop` (in `voice.rs`) start
// + tear down a thread that pushes JPEG-encoded frames at 10 fps via
// `voice-video-frame` keyed to the `__preview__` participant. The JS
// canvas dispatcher already handles arbitrary participant ids, so the
// Settings page just listens for that one and paints.

pub const PREVIEW_PARTICIPANT: &str = "__preview__";

pub struct PreviewCapture {
	is_running: Arc<AtomicBool>,
	join: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl PreviewCapture {
	pub fn new(
		device_id: Option<&str>,
		fps: Option<u32>,
		emit: Box<dyn Fn(RemoteFrame) + Send + Sync>,
	) -> Result<Self, String> {
		let camera_index = resolve_index(device_id);
		let is_running = Arc::new(AtomicBool::new(true));
		let stop = is_running.clone();
		let join = std::thread::Builder::new()
			.name(format!("syren-video-preview-{}", camera_index))
			.spawn(move || run_preview_loop(camera_index, emit, fps, stop))
			.map_err(|e| format!("spawn preview thread: {e}"))?;
		Ok(Self { is_running, join: Mutex::new(Some(join)) })
	}
}

impl Drop for PreviewCapture {
	fn drop(&mut self) {
		self.is_running.store(false, Ordering::Release);
		if let Some(h) = self.join.lock().take() {
			let _ = h.join();
		}
	}
}

fn run_preview_loop(
	camera_index: CameraIndex,
	emit: Box<dyn Fn(RemoteFrame) + Send + Sync>,
	target_fps: Option<u32>,
	is_running: Arc<AtomicBool>,
) {
	// Same reasoning as `run_capture_loop` — let nokhwa pick whatever
	// the camera natively offers; macOS AVFoundation rejects MJPEG-
	// targeted requests and `convert_to_i420` handles whichever shape
	// the buffer arrives in. Preview just renders into a small tile,
	// so any resolution is fine; we down-encode to JPEG anyway.
	let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestResolution);
	let mut camera = match Camera::new(camera_index.clone(), requested) {
		Ok(c) => c,
		Err(e) => {
			eprintln!("[voice/preview] open camera {camera_index:?} failed: {e}");
			return;
		}
	};

	apply_fps_preference(&mut camera, target_fps);
	let fmt = camera.camera_format();
	let width = fmt.resolution().width_x;
	let height = fmt.resolution().height_y;
	let frame_format = fmt.format();
	if let Err(e) = camera.open_stream() {
		eprintln!("[voice/preview] open_stream failed: {e}");
		return;
	}
	eprintln!(
		"[voice/preview] capture started ({}x{} {:?} {}fps)",
		width,
		height,
		frame_format,
		fmt.frame_rate()
	);

	let mut i420 = I420Buffer::new(width, height);
	let mut rgb_buf: Vec<u8> = Vec::new();
	// Standalone Settings preview is allowed to render at the camera's
	// chosen rate — there's no concurrent publish path eating CPU, so
	// the encoder can keep up with whatever fps the user picked.

	while is_running.load(Ordering::Acquire) {
		let buf = match camera.frame() {
			Ok(b) => b,
			Err(_) => continue,
		};
		if !convert_to_i420(buf.buffer(), frame_format, width, height, &mut i420) {
			continue;
		}

		// I420 → RGB → JPEG → emit. Helpers reuse `rgb_buf` so we
		// avoid a per-frame allocation, and the JPEG encode runs
		// through mozjpeg (SIMD libjpeg-turbo) instead of the pure-
		// Rust `image` crate so a 720p frame fits well under the
		// frame budget.
		if !i420_to_rgb(&i420, width, height, &mut rgb_buf) {
			continue;
		}
		let Some(jpeg) = encode_jpeg_rgb(&rgb_buf, width, height, PREVIEW_QUALITY) else {
			continue;
		};
		use base64::{engine::general_purpose::STANDARD, Engine};
		emit(RemoteFrame {
			participant: PREVIEW_PARTICIPANT.to_string(),
			track_sid: "preview".into(),
			width,
			height,
			jpeg_b64: STANDARD.encode(&jpeg),
		});
	}

	let _ = camera.stop_stream();
	eprintln!("[voice/preview] capture stopped");
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

	let mut rgb_buf: Vec<u8> = Vec::new();

	while let Some(frame) = stream.next().await {
		let i420 = frame.buffer.to_i420();
		let width = i420.width() as u32;
		let height = i420.height() as u32;

		if !i420_to_rgb(&i420, width, height, &mut rgb_buf) {
			continue;
		}
		let Some(jpeg) = encode_jpeg_rgb(&rgb_buf, width, height, PREVIEW_QUALITY) else {
			continue;
		};
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
