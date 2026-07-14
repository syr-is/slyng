//! S3-style upload presign + finalize shapes.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UploadPresignInput {
	pub filename: String,
	pub mime_type: String,
	pub size: u64,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub channel_id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UploadPresignResponse {
	pub upload_id: String,
	pub signed_url: String,
	pub final_url: String,
	pub max_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UploadFinalizeInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub sha256: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub width: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub height: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UploadFinalizeResponse {
	pub url: String,
	pub filename: String,
	pub mime_type: String,
	pub size: u64,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub width: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub height: Option<u32>,
}
