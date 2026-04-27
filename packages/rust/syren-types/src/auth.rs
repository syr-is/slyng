//! OAuth login, session exchange, and identity payloads. These shapes
//! aren't currently in `@syren/types` — they're spoken between the API's
//! `auth.controller.ts` and our client. Modeling them here lets the
//! generated TS schemas describe the auth handshake too.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// `POST /api/auth/login` request body.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct LoginRequest {
	pub instance_url: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub redirect: Option<String>,
}

/// `POST /api/auth/login` reply — the syr consent URL the system browser
/// (native) or current page (web) should navigate to.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct LoginResponse {
	pub consent_url: String,
}

/// `POST /api/auth/exchange` request body. Carries the one-shot bridge
/// token from the OAuth callback URL.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ExchangeRequest {
	pub code: String,
}

/// `POST /api/auth/exchange` reply — the long-lived session id used as a
/// Bearer token by every subsequent request.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ExchangeResponse {
	pub session: String,
}

/// `GET /api/auth/me` reply — the active session's identity. `did` is the
/// canonical user id used everywhere else (member rows, message senders,
/// audit log actors, …).
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Identity {
	pub did: String,
	pub syr_instance_url: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub delegate_public_key: Option<String>,
	#[serde(default)]
	pub trusted_domains: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub allow_dms: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub allow_friend_requests: Option<String>,
}
