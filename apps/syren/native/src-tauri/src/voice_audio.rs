//! Desktop audio I/O for voice. cpal pipes the system mic into the
//! LiveKit `NativeAudioSource` and pulls remote-participant audio out
//! of the mixer into the system speaker. Mobile platforms supply
//! their own capture / playback via JNI / FFI; this whole module is
//! gated to non-mobile targets.
//!
//! Pattern is lifted from `livekit/rust-sdks/examples/local_audio/`,
//! trimmed down — no echo cancellation, no dB metering, no
//! channel-selection knob. Voice chat for the syren client; the rest
//! is real-time-audio-engineering yak shaving we don't need yet.

#![cfg(not(any(target_os = "ios", target_os = "android")))]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, Sample, SampleFormat, SampleRate, SizedSample, Stream, StreamConfig};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

pub const SAMPLE_RATE: u32 = 48000;
pub const NUM_CHANNELS: u32 = 1;

// ── Mixer ───────────────────────────────────────────────────────────
//
// Single shared FIFO. Each remote participant's `NativeAudioStream`
// task `add_audio_data`s into it; the cpal output callback drains it
// with `get_samples`. This is FIFO-concatenation, not true sample-time
// mixing — when two participants speak simultaneously their frames
// interleave in arrival order rather than summing. For 2-3-person
// voice chat where speakers naturally take turns it sounds fine; for
// a busy multi-speaker channel it'll lag and chop. Proper per-
// participant ring-buffers + per-sample sum + soft-clip is a
// follow-up.

#[derive(Clone)]
pub struct AudioMixer {
	buffer: Arc<Mutex<VecDeque<i16>>>,
	max_buffer_size: usize,
	volume: f32,
}

impl AudioMixer {
	pub fn new(volume: f32) -> Self {
		// Hold up to ~1 second of audio.
		let max_buffer_size = SAMPLE_RATE as usize * NUM_CHANNELS as usize;
		Self {
			buffer: Arc::new(Mutex::new(VecDeque::with_capacity(max_buffer_size))),
			max_buffer_size,
			volume: volume.clamp(0.0, 1.0),
		}
	}

	pub fn add_audio_data(&self, data: &[i16]) {
		let mut buffer = self.buffer.lock();
		for &sample in data.iter() {
			let scaled = (sample as f32 * self.volume) as i16;
			buffer.push_back(scaled);
			if buffer.len() > self.max_buffer_size {
				buffer.pop_front();
			}
		}
	}

	pub fn drain_into(&self, out: &mut [i16]) {
		let mut buffer = self.buffer.lock();
		for slot in out.iter_mut() {
			*slot = buffer.pop_front().unwrap_or(0);
		}
	}
}

// ── Capture ─────────────────────────────────────────────────────────

pub struct AudioCapture {
	_stream: Stream,
	is_running: Arc<AtomicBool>,
}

impl AudioCapture {
	pub fn new(audio_tx: mpsc::UnboundedSender<Vec<i16>>) -> Result<Self, String> {
		let host = cpal::default_host();
		let device = host
			.default_input_device()
			.ok_or_else(|| "no default input device".to_string())?;
		let supported = device
			.default_input_config()
			.map_err(|e| format!("input config: {e}"))?;
		let supported_channels = supported.channels() as u32;
		let sample_format = supported.sample_format();

		// Capture at the device's native rate so we can pick `channel 0`
		// out of an interleaved frame; LiveKit re-samples internally if
		// needed.
		let config = StreamConfig {
			channels: supported.channels(),
			sample_rate: SampleRate(SAMPLE_RATE),
			buffer_size: cpal::BufferSize::Default,
		};

		let is_running = Arc::new(AtomicBool::new(true));

		let stream = match sample_format {
			SampleFormat::F32 => Self::open::<f32>(&device, &config, audio_tx, supported_channels, is_running.clone())?,
			SampleFormat::I16 => Self::open::<i16>(&device, &config, audio_tx, supported_channels, is_running.clone())?,
			SampleFormat::U16 => Self::open::<u16>(&device, &config, audio_tx, supported_channels, is_running.clone())?,
			other => return Err(format!("unsupported input sample format: {other:?}")),
		};
		stream.play().map_err(|e| format!("play input stream: {e}"))?;

		#[cfg(debug_assertions)]
		eprintln!("[voice/cpal] capture started ({:?}, {} ch)", sample_format, supported_channels);

		Ok(Self { _stream: stream, is_running })
	}

	fn open<T: SizedSample + Send + 'static>(
		device: &Device,
		config: &StreamConfig,
		audio_tx: mpsc::UnboundedSender<Vec<i16>>,
		num_channels: u32,
		is_running: Arc<AtomicBool>,
	) -> Result<Stream, String> {
		let channel_index = 0usize;
		device
			.build_input_stream(
				config,
				move |data: &[T], _info| {
					if !is_running.load(Ordering::Relaxed) {
						return;
					}
					let converted: Vec<i16> = data
						.iter()
						.skip(channel_index)
						.step_by(num_channels as usize)
						.map(|s| convert_to_i16(*s))
						.collect();
					let _ = audio_tx.send(converted);
				},
				|err| {
					#[cfg(debug_assertions)]
					eprintln!("[voice/cpal] input stream error: {err}");
					let _ = err;
				},
				None,
			)
			.map_err(|e| format!("build input stream: {e}"))
	}
}

impl Drop for AudioCapture {
	fn drop(&mut self) {
		self.is_running.store(false, Ordering::Relaxed);
	}
}

// ── Playback ────────────────────────────────────────────────────────

pub struct AudioPlayback {
	_stream: Stream,
	is_running: Arc<AtomicBool>,
}

impl AudioPlayback {
	pub fn new(mixer: AudioMixer) -> Result<Self, String> {
		let host = cpal::default_host();
		let device = host
			.default_output_device()
			.ok_or_else(|| "no default output device".to_string())?;
		let supported = device
			.default_output_config()
			.map_err(|e| format!("output config: {e}"))?;
		let sample_format = supported.sample_format();

		let config = StreamConfig {
			channels: NUM_CHANNELS as u16,
			sample_rate: SampleRate(SAMPLE_RATE),
			buffer_size: cpal::BufferSize::Default,
		};

		let is_running = Arc::new(AtomicBool::new(true));

		let stream = match sample_format {
			SampleFormat::F32 => Self::open::<f32>(&device, &config, mixer, is_running.clone())?,
			SampleFormat::I16 => Self::open::<i16>(&device, &config, mixer, is_running.clone())?,
			SampleFormat::U16 => Self::open::<u16>(&device, &config, mixer, is_running.clone())?,
			other => return Err(format!("unsupported output sample format: {other:?}")),
		};
		stream.play().map_err(|e| format!("play output stream: {e}"))?;

		#[cfg(debug_assertions)]
		eprintln!("[voice/cpal] playback started ({:?})", sample_format);

		Ok(Self { _stream: stream, is_running })
	}

	fn open<T>(
		device: &Device,
		config: &StreamConfig,
		mixer: AudioMixer,
		is_running: Arc<AtomicBool>,
	) -> Result<Stream, String>
	where
		T: SizedSample + Sample + Send + FromSample<f32> + 'static,
	{
		device
			.build_output_stream(
				config,
				move |data: &mut [T], _info| {
					if !is_running.load(Ordering::Relaxed) {
						for s in data.iter_mut() {
							*s = Sample::from_sample(0.0f32);
						}
						return;
					}
					let mut tmp = vec![0i16; data.len()];
					mixer.drain_into(&mut tmp);
					for (out, s) in data.iter_mut().zip(tmp.iter()) {
						*out = convert_from_i16::<T>(*s);
					}
				},
				|err| {
					#[cfg(debug_assertions)]
					eprintln!("[voice/cpal] output stream error: {err}");
					let _ = err;
				},
				None,
			)
			.map_err(|e| format!("build output stream: {e}"))
	}
}

impl Drop for AudioPlayback {
	fn drop(&mut self) {
		self.is_running.store(false, Ordering::Relaxed);
	}
}

// ── Sample conversion ───────────────────────────────────────────────
//
// cpal samples come in F32 / I16 / U16. LiveKit's `NativeAudioSource`
// wants I16. The conversions below mirror what the upstream example
// does — direct transmute when sizes match, scale when they don't.

fn convert_to_i16<T: SizedSample>(sample: T) -> i16 {
	if std::mem::size_of::<T>() == std::mem::size_of::<f32>() {
		let f = unsafe { std::mem::transmute_copy::<T, f32>(&sample) };
		(f.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
	} else if std::mem::size_of::<T>() == std::mem::size_of::<i16>() {
		unsafe { std::mem::transmute_copy::<T, i16>(&sample) }
	} else if std::mem::size_of::<T>() == std::mem::size_of::<u16>() {
		let u = unsafe { std::mem::transmute_copy::<T, u16>(&sample) };
		((u as i32) - (u16::MAX as i32 / 2)) as i16
	} else {
		0
	}
}

fn convert_from_i16<T: SizedSample + Sample + FromSample<f32>>(sample: i16) -> T {
	if std::mem::size_of::<T>() == std::mem::size_of::<f32>() {
		let f = sample as f32 / i16::MAX as f32;
		unsafe { std::mem::transmute_copy::<f32, T>(&f) }
	} else if std::mem::size_of::<T>() == std::mem::size_of::<i16>() {
		unsafe { std::mem::transmute_copy::<i16, T>(&sample) }
	} else if std::mem::size_of::<T>() == std::mem::size_of::<u16>() {
		let u = ((sample as i32) + (u16::MAX as i32 / 2)) as u16;
		unsafe { std::mem::transmute_copy::<u16, T>(&u) }
	} else {
		Sample::from_sample(0.0f32)
	}
}
