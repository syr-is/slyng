//! `#[wasm_bindgen]` surface — exposes the `Client` to JavaScript.
//!
//! The TS adapter at `packages/ts/client` wraps every method in a
//! typed function. Each method accepts/returns `JsValue` and
//! serialises through `serde_wasm_bindgen` so the TS side gets plain
//! JS objects, not opaque opaque pointers.

#![cfg(target_arch = "wasm32")]

use crate::client::Client as InnerClient;
use crate::session::LocalStorageStore;
use crate::types::{LoginRequest, Paginated};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

fn jsv<T: serde::Serialize>(v: &T) -> std::result::Result<JsValue, JsValue> {
	serde_wasm_bindgen::to_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn from_jsv<T: serde::de::DeserializeOwned>(v: JsValue) -> std::result::Result<T, JsValue> {
	serde_wasm_bindgen::from_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub struct Client {
	inner: InnerClient,
}

#[wasm_bindgen]
impl Client {
	#[wasm_bindgen(constructor)]
	pub fn new(base_url: &str, session_key: Option<String>) -> std::result::Result<Client, JsValue> {
		let key = session_key.unwrap_or_else(|| "syren_session".to_string());
		let store = Arc::new(LocalStorageStore::new(key));
		let inner = InnerClient::with_store(base_url.to_string(), store)
			.map_err(|e| JsValue::from_str(&e.to_string()))?;
		Ok(Self { inner })
	}

	// ── Generic transport — used by the web app's @syren/app-core
	// `setApiTransport` so every method on api.ts goes through the
	// same Rust transport (cookie / bearer / retry / error parsing)
	// that the typed methods below use, without each call site
	// needing its own TS↔WASM binding. Mirrors the `proxy_request`
	// Tauri command on native.
	pub async fn request_raw(
		&self,
		method: String,
		path: String,
		body: JsValue,
	) -> std::result::Result<JsValue, JsValue> {
		let body_val: Option<serde_json::Value> = if body.is_undefined() || body.is_null() {
			None
		} else {
			Some(from_jsv(body)?)
		};
		let v = self
			.inner
			.request_raw(&method, &path, body_val)
			.await
			.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Auth ──

	pub async fn login_start(&self, instance_url: String, redirect: Option<String>) -> std::result::Result<JsValue, JsValue> {
		let resp = self
			.inner
			.login_start(instance_url, redirect)
			.await
			.map_err(JsValue::from)?;
		jsv(&resp)
	}

	pub async fn login_complete(&self, code: String) -> std::result::Result<JsValue, JsValue> {
		let id = self
			.inner
			.login_complete(code)
			.await
			.map_err(JsValue::from)?;
		jsv(&id)
	}

	pub async fn me(&self) -> std::result::Result<JsValue, JsValue> {
		let id = self.inner.me().await.map_err(JsValue::from)?;
		jsv(&id)
	}

	pub async fn logout(&self) -> std::result::Result<(), JsValue> {
		self.inner.logout().await.map_err(JsValue::from)
	}

	// ── Servers ──

	pub async fn servers_list(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.servers_list().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_get(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_get(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_channels(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_channels(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_members(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_members(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Channels ──

	pub async fn channel_messages(
		&self,
		id: String,
		before: Option<String>,
		limit: Option<u32>,
	) -> std::result::Result<JsValue, JsValue> {
		let v = self
			.inner
			.channel_messages(&id, before.as_deref(), limit)
			.await
			.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_send(&self, id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.channel_send(&id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_typing(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_typing(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Users ──

	pub async fn users_me(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.users_me().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn dm_channels(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.dm_channels().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Roles ──

	pub async fn roles_list(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.roles_list(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn my_permissions(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.my_permissions(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Categories ──

	pub async fn categories_list(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.categories_list(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Relations ──

	pub async fn relations_snapshot(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.relations_snapshot().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Invites ──

	pub async fn invite_preview(&self, code: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.invite_preview(&code).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn invite_join(&self, code: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.invite_join(&code).await.map_err(JsValue::from)?;
		jsv(&v)
	}
}

// Suppress unused-warning until we plumb pagination through here.
#[allow(dead_code)]
fn _kept(_: Paginated, _: LoginRequest) {}
