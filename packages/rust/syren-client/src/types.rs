//! API request/response DTOs. Mirrors the shape the existing
//! `apps/syren/web/src/lib/api.ts` consumes today; wire-compatible with
//! the NestJS API at `apps/syren/api/src`. We keep most fields as
//! `serde_json::Value` for now — typing a moving target like the
//! channel/server schema strictly here would require codegen we'll add
//! in a follow-up. The high-traffic endpoints (auth, login, me) get
//! tight types; everything else returns the JSON value untouched.

use serde::{Deserialize, Serialize};

// ── Auth ──

#[derive(Debug, Serialize)]
pub struct LoginRequest {
	pub instance_url: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub redirect: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LoginResponse {
	pub consent_url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Identity {
	pub did: String,
	pub syr_instance_url: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub delegate_public_key: Option<String>,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub trusted_domains: Vec<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub allow_dms: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub allow_friend_requests: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExchangeRequest {
	pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeResponse {
	pub session: String,
}

// ── Pagination ──

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct Paginated {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub limit: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub offset: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub sort: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub order: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub q: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Page<T> {
	pub items: Vec<T>,
	pub total: u64,
}

// ── Generic JSON pass-through ──
//
// Most endpoints (servers, channels, messages, ...) return rich nested
// shapes that the JS-side code reads dynamically. For now we treat
// them as raw JSON values; a later codegen pass will type them.
pub type Json = serde_json::Value;
