//! Device enumeration for the Settings UI.
//!
//! The Tauri WebView isn't a secure context so `navigator.mediaDevices`
//! isn't available — settings would otherwise show empty pickers. cpal
//! gives us the real CoreAudio / WASAPI / ALSA-PulseAudio device list
//! for mics + speakers; nokhwa does the same for cameras through the
//! per-platform native backend selected in `Cargo.toml`.
//!
//! Mobile targets stub the impls with empty lists — Android / iOS will
//! wire device enumeration through the platform shell (Kotlin
//! `MediaRouter` / iOS `AVAudioSession`) in a follow-up. Keeping the
//! Tauri commands present on every target lets the JS side call them
//! unconditionally.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct DeviceInfo {
	/// Stable identifier the JS side passes back when picking a device.
	/// For audio: the cpal `device.name()`. For cameras: the nokhwa
	/// camera index serialised as a string.
	pub id: String,
	pub label: String,
	pub is_default: bool,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod desktop {
	use super::DeviceInfo;
	use cpal::traits::{DeviceTrait, HostTrait};

	pub fn list_audio_inputs() -> Vec<DeviceInfo> {
		let host = cpal::default_host();
		let default_name = host
			.default_input_device()
			.and_then(|d| d.name().ok())
			.unwrap_or_default();

		host.input_devices()
			.map(|iter| {
				iter.filter_map(|d| {
					let name = d.name().ok()?;
					let is_default = name == default_name;
					Some(DeviceInfo { id: name.clone(), label: name, is_default })
				})
				.collect()
			})
			.unwrap_or_default()
	}

	pub fn list_audio_outputs() -> Vec<DeviceInfo> {
		let host = cpal::default_host();
		let default_name = host
			.default_output_device()
			.and_then(|d| d.name().ok())
			.unwrap_or_default();

		host.output_devices()
			.map(|iter| {
				iter.filter_map(|d| {
					let name = d.name().ok()?;
					let is_default = name == default_name;
					Some(DeviceInfo { id: name.clone(), label: name, is_default })
				})
				.collect()
			})
			.unwrap_or_default()
	}

	pub fn list_cameras() -> Vec<DeviceInfo> {
		use nokhwa::query;
		use nokhwa::utils::ApiBackend;

		match query(ApiBackend::Auto) {
			Ok(cameras) => cameras
				.into_iter()
				.enumerate()
				.map(|(i, info)| DeviceInfo {
					id: info.index().to_string(),
					label: info.human_name(),
					// nokhwa doesn't surface a "default" flag; the first
					// entry is almost always the system-preferred one.
					is_default: i == 0,
				})
				.collect(),
			Err(e) => {
				#[cfg(debug_assertions)]
				eprintln!("[device_enum] camera query failed: {e}");
				let _ = e;
				Vec::new()
			}
		}
	}
}

#[cfg(any(target_os = "ios", target_os = "android"))]
mod desktop {
	use super::DeviceInfo;
	pub fn list_audio_inputs() -> Vec<DeviceInfo> { Vec::new() }
	pub fn list_audio_outputs() -> Vec<DeviceInfo> { Vec::new() }
	pub fn list_cameras() -> Vec<DeviceInfo> { Vec::new() }
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn audio_list_inputs() -> Result<Vec<DeviceInfo>, String> {
	Ok(desktop::list_audio_inputs())
}

#[tauri::command]
pub async fn audio_list_outputs() -> Result<Vec<DeviceInfo>, String> {
	Ok(desktop::list_audio_outputs())
}

#[tauri::command]
pub async fn video_list_cameras() -> Result<Vec<DeviceInfo>, String> {
	Ok(desktop::list_cameras())
}
