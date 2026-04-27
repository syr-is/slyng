//! `#[wasm_bindgen]` surface — exposes the `Client` to JavaScript.
//!
//! The TS adapter at `packages/ts/client` wraps every method in a
//! typed function. Each method accepts/returns `JsValue` and
//! serialises through `serde_wasm_bindgen` so the TS side gets plain
//! JS objects, not opaque pointers.

#![cfg(target_arch = "wasm32")]

use crate::client::Client as InnerClient;
use crate::session::LocalStorageStore;
use crate::types::{LoginRequest, Paginated};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

fn jsv<T: serde::Serialize>(v: &T) -> std::result::Result<JsValue, JsValue> {
	// `serde_wasm_bindgen::to_value` defaults to legacy serialization, which
	// turns serde_json `Object`s into JS `Map`s — `obj.id` reads as
	// `undefined` because Map access wants `.get('id')`. The TS adapter
	// types every WASM return as a plain object (Server, Channel,
	// ServerMember…), so without a JSON-compatible serializer every
	// downstream `server.id`, `channel.name`, etc. comes back undefined
	// at runtime. `Serializer::json_compatible()` produces plain JS
	// objects + JS Arrays, matching what the API was returning prior to
	// the WASM-client migration.
	let serializer = serde_wasm_bindgen::Serializer::json_compatible();
	v.serialize(&serializer)
		.map_err(|e| JsValue::from_str(&e.to_string()))
}

fn from_jsv<T: serde::de::DeserializeOwned>(v: JsValue) -> std::result::Result<T, JsValue> {
	serde_wasm_bindgen::from_value(v).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn jsv_unit() -> std::result::Result<JsValue, JsValue> {
	Ok(JsValue::UNDEFINED)
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

	// ── Auth ──

	pub async fn login_start(&self, instance_url: String, redirect: Option<String>) -> std::result::Result<JsValue, JsValue> {
		let resp = self.inner.login_start(instance_url, redirect).await.map_err(JsValue::from)?;
		jsv(&resp)
	}

	pub async fn login_complete(&self, code: String) -> std::result::Result<JsValue, JsValue> {
		let id = self.inner.login_complete(code).await.map_err(JsValue::from)?;
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

	pub async fn server_create(&self, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.server_create(&body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_update(&self, id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.server_update(&id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_delete(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_delete(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_leave(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_leave(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_transfer_ownership(&self, server_id: String, new_owner_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_transfer_ownership(&server_id, &new_owner_id).await.map_err(JsValue::from)?;
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

	pub async fn server_members_page(&self, id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: Paginated = if params.is_undefined() || params.is_null() {
			Paginated::default()
		} else {
			from_jsv(params)?
		};
		let v = self.inner.server_members_page(&id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_voice_states(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.server_voice_states(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn server_create_channel(&self, server_id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.server_create_channel(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_kick(
		&self,
		server_id: String,
		user_id: String,
		delete_seconds: Option<u32>,
	) -> std::result::Result<JsValue, JsValue> {
		let v = self
			.inner
			.member_kick(&server_id, &user_id, delete_seconds)
			.await
			.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_ban(&self, server_id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.member_ban(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_unban(&self, server_id: String, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.member_unban(&server_id, &user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn list_bans(&self, server_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.list_bans(&server_id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_messages(&self, server_id: String, user_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.member_messages(&server_id, &user_id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_message_stats(&self, server_id: String, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.member_message_stats(&server_id, &user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn purge_member_messages(&self, server_id: String, user_id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.purge_member_messages(&server_id, &user_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_ban_history(&self, server_id: String, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.member_ban_history(&server_id, &user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn audit_log(&self, server_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.audit_log(&server_id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn member_audit_log(&self, server_id: String, user_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.member_audit_log(&server_id, &user_id, &p).await.map_err(JsValue::from)?;
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

	pub async fn invites_create(&self, server_id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.invites_create(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn invites_list(&self, server_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: Paginated = if params.is_undefined() || params.is_null() { Paginated::default() } else { from_jsv(params)? };
		let v = self.inner.invites_list(&server_id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn invite_delete(&self, server_id: String, code: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.invite_delete(&server_id, &code).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn update_invite(&self, server_id: String, code: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.update_invite(&server_id, &code, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Trash ──

	pub async fn trash_channels(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.trash_channels(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn trash_roles(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.trash_roles(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn trash_messages(&self, server_id: String, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.trash_messages(&server_id, &p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Channels ──

	pub async fn channel_messages(
		&self,
		id: String,
		before: Option<String>,
		limit: Option<u32>,
		include_deleted: Option<bool>,
	) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_messages(&id, before.as_deref(), limit, include_deleted).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_send(&self, id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.channel_send(&id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_edit_message(&self, channel_id: String, message_id: String, content: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_edit_message(&channel_id, &message_id, &content).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_delete_message(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_delete_message(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_clear_embeds(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_clear_embeds(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_add_reaction(&self, channel_id: String, message_id: String, kind: String, value: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_add_reaction(&channel_id, &message_id, &kind, &value).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_pins(&self, id: String, include_deleted: Option<bool>) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_pins(&id, include_deleted).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_pin(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_pin(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_unpin(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_unpin(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_typing(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_typing(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_update(&self, id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.channel_update(&id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_delete(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_delete(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_restore(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_restore(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_hard_delete(&self, id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_hard_delete(&id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_restore_message(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_restore_message(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_hard_delete_message(&self, channel_id: String, message_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.channel_hard_delete_message(&channel_id, &message_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn channel_reorder(&self, server_id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.channel_reorder(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Roles ──

	pub async fn roles_list(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.roles_list(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_create(&self, server_id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.role_create(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_update(&self, role_id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.role_update(&role_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_delete(&self, role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_delete(&role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_swap(&self, role_id: String, other_role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_swap(&role_id, &other_role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_assign(&self, server_id: String, user_id: String, role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_assign(&server_id, &user_id, &role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_unassign(&self, server_id: String, user_id: String, role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_unassign(&server_id, &user_id, &role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_reorder(&self, server_id: String, role_ids: JsValue) -> std::result::Result<JsValue, JsValue> {
		let ids: Vec<String> = from_jsv(role_ids)?;
		let v = self.inner.role_reorder(&server_id, &ids).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn my_permissions(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.my_permissions(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_permission_tree(&self, server_id: String, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_permission_tree(&server_id, &user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_member_permissions(&self, server_id: String, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_member_permissions(&server_id, &user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_restore(&self, role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_restore(&role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn role_hard_delete(&self, role_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.role_hard_delete(&role_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Categories ──

	pub async fn categories_list(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.categories_list(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn category_create(&self, server_id: String, name: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.category_create(&server_id, &name).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn category_update(&self, category_id: String, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.category_update(&category_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn category_delete(&self, category_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.category_delete(&category_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn category_swap(&self, a: String, b: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.category_swap(&a, &b).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn category_reorder(&self, server_id: String, ids: JsValue) -> std::result::Result<JsValue, JsValue> {
		let ids: Vec<String> = from_jsv(ids)?;
		let v = self.inner.category_reorder(&server_id, &ids).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Users ──

	pub async fn users_me(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.users_me().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn users_resolve(&self, q: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.users_resolve(&q).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn users_update_me(&self, data: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		let v = self.inner.users_update_me(&body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn dm_channels(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.dm_channels().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn create_dm(&self, recipient_id: String, syr_instance_url: Option<String>) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.create_dm(&recipient_id, syr_instance_url.as_deref()).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Relations ──

	pub async fn relations_snapshot(&self) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.relations_snapshot().await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn list_friends(&self, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.list_friends(&p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn list_blocked(&self, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.list_blocked(&p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn list_ignored(&self, params: JsValue) -> std::result::Result<JsValue, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() { serde_json::json!({}) } else { from_jsv(params)? };
		let v = self.inner.list_ignored(&p).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn friend_send(&self, user_id: String, syr_instance_url: Option<String>) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.friend_send(&user_id, syr_instance_url.as_deref()).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn friend_accept(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.friend_accept(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn friend_decline(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.friend_decline(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn friend_remove(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.friend_remove(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn block(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.block(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn unblock(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.unblock(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn ignore(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.ignore(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn unignore(&self, user_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.unignore(&user_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Voice ──

	pub async fn voice_token(&self, channel_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.voice_token(&channel_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Uploads ──

	pub async fn upload_presign(&self, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.upload_presign(&body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn upload_finalize(&self, upload_id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.upload_finalize(&upload_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	// ── Permission overrides ──

	pub async fn overrides_list(&self, server_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.overrides_list(&server_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn overrides_for_channel(&self, server_id: String, channel_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.overrides_for_channel(&server_id, &channel_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn overrides_for_category(&self, server_id: String, category_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.overrides_for_category(&server_id, &category_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn override_upsert(&self, server_id: String, body: JsValue) -> std::result::Result<JsValue, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		let v = self.inner.override_upsert(&server_id, &body).await.map_err(JsValue::from)?;
		jsv(&v)
	}

	pub async fn override_delete(&self, server_id: String, override_id: String) -> std::result::Result<JsValue, JsValue> {
		let v = self.inner.override_delete(&server_id, &override_id).await.map_err(JsValue::from)?;
		jsv(&v)
	}
}

// Suppress unused-warning until we plumb pagination through here.
#[allow(dead_code)]
fn _kept(_: LoginRequest, _: JsValue) -> std::result::Result<JsValue, JsValue> { jsv_unit() }
