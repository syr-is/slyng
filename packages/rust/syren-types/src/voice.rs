//! Voice token + voice-state shapes (LiveKit signalling).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// `POST /api/channels/:id/voice/token` reply. Used to authenticate the
/// LiveKit room join handshake.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct VoiceTokenResponse {
	pub token: String,
	pub url: String,
}

/// One participant's voice state inside a voice channel.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct VoiceState {
	pub user_id: String,
	pub channel_id: String,
	pub server_id: String,
	#[serde(default)]
	pub self_mute: bool,
	#[serde(default)]
	pub self_deaf: bool,
	#[serde(default)]
	pub has_camera: bool,
	#[serde(default)]
	pub has_screen: bool,
}

/// `GET /api/servers/:id/voice-states` reply: keyed by channel id, each
/// value is the list of participants currently in that voice channel.
pub type VoiceStatesByChannel = HashMap<String, Vec<VoiceState>>;

/// Body for `POST /api/voice/token`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct VoiceTokenInput {
	pub channel_id: String,
}
