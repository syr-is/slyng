//! `#[wasm_bindgen]` surface — exposes the `Client` to JavaScript.
//!
//! Every method's return type is the typed Rust struct from
//! `syren-types`. The structs carry `#[derive(Tsify)]
//! #[tsify(into_wasm_abi, from_wasm_abi)]`, so wasm-bindgen knows how
//! to ferry them across the boundary and wasm-pack emits a `.d.ts`
//! with the matching TS interface for each method's `Promise<…>`
//! return. The TS adapter at `packages/ts/client/src/adapter.ts`
//! consumes that `.d.ts` directly — no `as Promise<Server[]>` casts,
//! no hand-rolled interfaces.

#![cfg(target_arch = "wasm32")]

use crate::client::Client as InnerClient;
use crate::session::LocalStorageStore;
use serde::Serialize;
use std::sync::Arc;
use syren_types::{
	AllowDms, AllowFriendRequests, BlockedRow, Channel, ChannelCategory, CreateDmResponse,
	CreateInviteResponse, DmChannelSummary, ExchangeRequest, ExchangeResponse, FriendshipRow,
	Identity, IgnoredRow, InviteJoinResponse, InvitePreview, LoginResponse, MemberMessageEntry,
	MemberMessageStats, MemberPermissionsView, Message, MyPermissions, Page, PageAuditLog,
	PageBlockedRow, PageFriendshipRow, PageIgnoredRow, PageMemberMessageEntry, PageServerBan,
	PageServerInvite, PageServerMember, PageTrashMessageEntry, PaginatedQuery, PermissionOverride,
	PermissionTree, RelationsSnapshot, Server, ServerBan, ServerMember, ServerRole,
	SuccessResponse, TransferOwnershipResponse, TrashChannelEntry, TrashMessageEntry, TrashRoleEntry,
	UploadFinalizeResponse, UploadPresignResponse, User, UserResolveResult, VoiceTokenResponse,
	VoiceStatesByChannel,
};
use wasm_bindgen::prelude::*;

fn err(e: impl std::fmt::Display) -> JsValue {
	JsValue::from_str(&e.to_string())
}

fn from_jsv<T: serde::de::DeserializeOwned>(v: JsValue) -> std::result::Result<T, JsValue> {
	serde_wasm_bindgen::from_value(v).map_err(err)
}

#[wasm_bindgen]
pub struct Client {
	inner: InnerClient,
}

#[wasm_bindgen]
impl Client {
	#[wasm_bindgen(constructor)]
	pub fn new(
		base_url: &str,
		session_key: Option<String>,
	) -> std::result::Result<Client, JsValue> {
		let key = session_key.unwrap_or_else(|| "syren_session".to_string());
		let store = Arc::new(LocalStorageStore::new(key));
		let inner = InnerClient::with_store(base_url.to_string(), store).map_err(err)?;
		Ok(Self { inner })
	}

	// ── Auth ──

	pub async fn login_start(
		&self,
		instance_url: String,
		redirect: Option<String>,
	) -> std::result::Result<LoginResponse, JsValue> {
		self.inner.login_start(instance_url, redirect).await.map_err(err)
	}

	pub async fn login_complete(&self, code: String) -> std::result::Result<Identity, JsValue> {
		self.inner.login_complete(code).await.map_err(err)
	}

	pub async fn me(&self) -> std::result::Result<Identity, JsValue> {
		self.inner.me().await.map_err(err)
	}

	pub async fn logout(&self) -> std::result::Result<(), JsValue> {
		self.inner.logout().await.map_err(err)
	}

	// ── Servers ──

	pub async fn servers_list(&self) -> std::result::Result<Vec<Server>, JsValue> {
		self.inner.servers_list().await.map_err(err)
	}

	pub async fn server_get(&self, id: String) -> std::result::Result<Server, JsValue> {
		self.inner.server_get(&id).await.map_err(err)
	}

	pub async fn server_create(&self, data: JsValue) -> std::result::Result<Server, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.server_create(&body).await.map_err(err)
	}

	pub async fn server_update(
		&self,
		id: String,
		data: JsValue,
	) -> std::result::Result<Server, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.server_update(&id, &body).await.map_err(err)
	}

	pub async fn server_delete(
		&self,
		id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.server_delete(&id).await.map_err(err)
	}

	pub async fn server_leave(
		&self,
		id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.server_leave(&id).await.map_err(err)
	}

	pub async fn server_transfer_ownership(
		&self,
		server_id: String,
		new_owner_id: String,
	) -> std::result::Result<TransferOwnershipResponse, JsValue> {
		self.inner
			.server_transfer_ownership(&server_id, &new_owner_id)
			.await
			.map_err(err)
	}

	pub async fn server_channels(
		&self,
		id: String,
	) -> std::result::Result<Vec<Channel>, JsValue> {
		self.inner.server_channels(&id).await.map_err(err)
	}

	pub async fn server_members(
		&self,
		id: String,
	) -> std::result::Result<Vec<ServerMember>, JsValue> {
		self.inner.server_members(&id).await.map_err(err)
	}

	pub async fn server_members_page(
		&self,
		id: String,
		params: JsValue,
	) -> std::result::Result<PageServerMember, JsValue> {
		let p: PaginatedQuery = if params.is_undefined() || params.is_null() {
			PaginatedQuery::default()
		} else {
			from_jsv(params)?
		};
		let page: Page<ServerMember> = self.inner.server_members_page(&id, &p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn server_voice_states(
		&self,
		id: String,
	) -> std::result::Result<JsValue, JsValue> {
		// `VoiceStatesByChannel` is a HashMap; tsify produces `Map<…>`
		// for HashMap by default, which trips up plain-object access on
		// the JS side. Keep this one going through serde-wasm-bindgen's
		// json_compatible serializer so it ferries as a plain JS object.
		let v: VoiceStatesByChannel = self.inner.server_voice_states(&id).await.map_err(err)?;
		let s = serde_wasm_bindgen::Serializer::json_compatible();
		v.serialize(&s).map_err(err)
	}

	pub async fn server_create_channel(
		&self,
		server_id: String,
		data: JsValue,
	) -> std::result::Result<Channel, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner
			.server_create_channel(&server_id, &body)
			.await
			.map_err(err)
	}

	pub async fn member_kick(
		&self,
		server_id: String,
		user_id: String,
		delete_seconds: Option<u32>,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.member_kick(&server_id, &user_id, delete_seconds)
			.await
			.map_err(err)
	}

	pub async fn member_ban(
		&self,
		server_id: String,
		body: JsValue,
	) -> std::result::Result<ServerBan, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner.member_ban(&server_id, &body).await.map_err(err)
	}

	pub async fn member_unban(
		&self,
		server_id: String,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.member_unban(&server_id, &user_id)
			.await
			.map_err(err)
	}

	pub async fn list_bans(
		&self,
		server_id: String,
		params: JsValue,
	) -> std::result::Result<PageServerBan, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self.inner.list_bans(&server_id, &p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn member_messages(
		&self,
		server_id: String,
		user_id: String,
		params: JsValue,
	) -> std::result::Result<PageMemberMessageEntry, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self
			.inner
			.member_messages(&server_id, &user_id, &p)
			.await
			.map_err(err)?;
		Ok(page.into())
	}

	pub async fn member_message_stats(
		&self,
		server_id: String,
		user_id: String,
	) -> std::result::Result<MemberMessageStats, JsValue> {
		self.inner
			.member_message_stats(&server_id, &user_id)
			.await
			.map_err(err)
	}

	pub async fn purge_member_messages(
		&self,
		server_id: String,
		user_id: String,
		body: JsValue,
	) -> std::result::Result<SuccessResponse, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner
			.purge_member_messages(&server_id, &user_id, &body)
			.await
			.map_err(err)
	}

	pub async fn member_ban_history(
		&self,
		server_id: String,
		user_id: String,
	) -> std::result::Result<Vec<ServerBan>, JsValue> {
		self.inner
			.member_ban_history(&server_id, &user_id)
			.await
			.map_err(err)
	}

	pub async fn audit_log(
		&self,
		server_id: String,
		params: JsValue,
	) -> std::result::Result<PageAuditLog, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self.inner.audit_log(&server_id, &p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn member_audit_log(
		&self,
		server_id: String,
		user_id: String,
		params: JsValue,
	) -> std::result::Result<PageAuditLog, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self
			.inner
			.member_audit_log(&server_id, &user_id, &p)
			.await
			.map_err(err)?;
		Ok(page.into())
	}

	// ── Invites ──

	pub async fn invite_preview(
		&self,
		code: String,
	) -> std::result::Result<InvitePreview, JsValue> {
		self.inner.invite_preview(&code).await.map_err(err)
	}

	pub async fn invite_join(
		&self,
		code: String,
	) -> std::result::Result<InviteJoinResponse, JsValue> {
		self.inner.invite_join(&code).await.map_err(err)
	}

	pub async fn invites_create(
		&self,
		server_id: String,
		data: JsValue,
	) -> std::result::Result<CreateInviteResponse, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner
			.invites_create(&server_id, &body)
			.await
			.map_err(err)
	}

	pub async fn invites_list(
		&self,
		server_id: String,
		params: JsValue,
	) -> std::result::Result<PageServerInvite, JsValue> {
		let p: PaginatedQuery = if params.is_undefined() || params.is_null() {
			PaginatedQuery::default()
		} else {
			from_jsv(params)?
		};
		let page = self.inner.invites_list(&server_id, &p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn invite_delete(
		&self,
		server_id: String,
		code: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.invite_delete(&server_id, &code)
			.await
			.map_err(err)
	}

	pub async fn update_invite(
		&self,
		server_id: String,
		code: String,
		data: JsValue,
	) -> std::result::Result<syren_types::ServerInvite, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner
			.update_invite(&server_id, &code, &body)
			.await
			.map_err(err)
	}

	// ── Trash ──

	pub async fn trash_channels(
		&self,
		server_id: String,
	) -> std::result::Result<Vec<TrashChannelEntry>, JsValue> {
		self.inner.trash_channels(&server_id).await.map_err(err)
	}

	pub async fn trash_roles(
		&self,
		server_id: String,
	) -> std::result::Result<Vec<TrashRoleEntry>, JsValue> {
		self.inner.trash_roles(&server_id).await.map_err(err)
	}

	pub async fn trash_messages(
		&self,
		server_id: String,
		params: JsValue,
	) -> std::result::Result<PageTrashMessageEntry, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self
			.inner
			.trash_messages(&server_id, &p)
			.await
			.map_err(err)?;
		Ok(page.into())
	}

	// ── Channels ──

	pub async fn channel_messages(
		&self,
		id: String,
		before: Option<String>,
		limit: Option<u32>,
		include_deleted: Option<bool>,
	) -> std::result::Result<Vec<Message>, JsValue> {
		self.inner
			.channel_messages(&id, before.as_deref(), limit, include_deleted)
			.await
			.map_err(err)
	}

	pub async fn channel_send(
		&self,
		id: String,
		body: JsValue,
	) -> std::result::Result<Message, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner.channel_send(&id, &body).await.map_err(err)
	}

	pub async fn channel_edit_message(
		&self,
		channel_id: String,
		message_id: String,
		content: String,
	) -> std::result::Result<Message, JsValue> {
		self.inner
			.channel_edit_message(&channel_id, &message_id, &content)
			.await
			.map_err(err)
	}

	pub async fn channel_delete_message(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.channel_delete_message(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_clear_embeds(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<Message, JsValue> {
		self.inner
			.channel_clear_embeds(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_add_reaction(
		&self,
		channel_id: String,
		message_id: String,
		kind: String,
		value: String,
	) -> std::result::Result<Message, JsValue> {
		self.inner
			.channel_add_reaction(&channel_id, &message_id, &kind, &value)
			.await
			.map_err(err)
	}

	pub async fn channel_pins(
		&self,
		id: String,
		include_deleted: Option<bool>,
	) -> std::result::Result<Vec<Message>, JsValue> {
		self.inner
			.channel_pins(&id, include_deleted)
			.await
			.map_err(err)
	}

	pub async fn channel_pin(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.channel_pin(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_unpin(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.channel_unpin(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_typing(
		&self,
		id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.channel_typing(&id).await.map_err(err)
	}

	pub async fn channel_update(
		&self,
		id: String,
		data: JsValue,
	) -> std::result::Result<Channel, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.channel_update(&id, &body).await.map_err(err)
	}

	pub async fn channel_delete(
		&self,
		id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.channel_delete(&id).await.map_err(err)
	}

	pub async fn channel_restore(
		&self,
		id: String,
	) -> std::result::Result<Channel, JsValue> {
		self.inner.channel_restore(&id).await.map_err(err)
	}

	pub async fn channel_hard_delete(
		&self,
		id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.channel_hard_delete(&id).await.map_err(err)
	}

	pub async fn channel_restore_message(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<Message, JsValue> {
		self.inner
			.channel_restore_message(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_hard_delete_message(
		&self,
		channel_id: String,
		message_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.channel_hard_delete_message(&channel_id, &message_id)
			.await
			.map_err(err)
	}

	pub async fn channel_reorder(
		&self,
		server_id: String,
		body: JsValue,
	) -> std::result::Result<SuccessResponse, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner
			.channel_reorder(&server_id, &body)
			.await
			.map_err(err)
	}

	// ── Roles ──

	pub async fn roles_list(
		&self,
		server_id: String,
	) -> std::result::Result<Vec<ServerRole>, JsValue> {
		self.inner.roles_list(&server_id).await.map_err(err)
	}

	pub async fn role_create(
		&self,
		server_id: String,
		data: JsValue,
	) -> std::result::Result<ServerRole, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.role_create(&server_id, &body).await.map_err(err)
	}

	pub async fn role_update(
		&self,
		role_id: String,
		data: JsValue,
	) -> std::result::Result<ServerRole, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.role_update(&role_id, &body).await.map_err(err)
	}

	pub async fn role_delete(
		&self,
		role_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.role_delete(&role_id).await.map_err(err)
	}

	pub async fn role_swap(
		&self,
		role_id: String,
		other_role_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.role_swap(&role_id, &other_role_id)
			.await
			.map_err(err)
	}

	pub async fn role_assign(
		&self,
		server_id: String,
		user_id: String,
		role_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.role_assign(&server_id, &user_id, &role_id)
			.await
			.map_err(err)
	}

	pub async fn role_unassign(
		&self,
		server_id: String,
		user_id: String,
		role_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.role_unassign(&server_id, &user_id, &role_id)
			.await
			.map_err(err)
	}

	pub async fn role_reorder(
		&self,
		server_id: String,
		role_ids: JsValue,
	) -> std::result::Result<SuccessResponse, JsValue> {
		let ids: Vec<String> = from_jsv(role_ids)?;
		self.inner.role_reorder(&server_id, &ids).await.map_err(err)
	}

	pub async fn my_permissions(
		&self,
		server_id: String,
	) -> std::result::Result<MyPermissions, JsValue> {
		self.inner.my_permissions(&server_id).await.map_err(err)
	}

	pub async fn role_permission_tree(
		&self,
		server_id: String,
		user_id: String,
	) -> std::result::Result<PermissionTree, JsValue> {
		self.inner
			.role_permission_tree(&server_id, &user_id)
			.await
			.map_err(err)
	}

	pub async fn role_member_permissions(
		&self,
		server_id: String,
		user_id: String,
	) -> std::result::Result<MemberPermissionsView, JsValue> {
		self.inner
			.role_member_permissions(&server_id, &user_id)
			.await
			.map_err(err)
	}

	pub async fn role_restore(
		&self,
		role_id: String,
	) -> std::result::Result<ServerRole, JsValue> {
		self.inner.role_restore(&role_id).await.map_err(err)
	}

	pub async fn role_hard_delete(
		&self,
		role_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.role_hard_delete(&role_id).await.map_err(err)
	}

	// ── Categories ──

	pub async fn categories_list(
		&self,
		server_id: String,
	) -> std::result::Result<Vec<ChannelCategory>, JsValue> {
		self.inner.categories_list(&server_id).await.map_err(err)
	}

	pub async fn category_create(
		&self,
		server_id: String,
		name: String,
	) -> std::result::Result<ChannelCategory, JsValue> {
		self.inner
			.category_create(&server_id, &name)
			.await
			.map_err(err)
	}

	pub async fn category_update(
		&self,
		category_id: String,
		data: JsValue,
	) -> std::result::Result<ChannelCategory, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner
			.category_update(&category_id, &body)
			.await
			.map_err(err)
	}

	pub async fn category_delete(
		&self,
		category_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.category_delete(&category_id).await.map_err(err)
	}

	pub async fn category_swap(
		&self,
		a: String,
		b: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.category_swap(&a, &b).await.map_err(err)
	}

	pub async fn category_reorder(
		&self,
		server_id: String,
		ids: JsValue,
	) -> std::result::Result<SuccessResponse, JsValue> {
		let ids: Vec<String> = from_jsv(ids)?;
		self.inner
			.category_reorder(&server_id, &ids)
			.await
			.map_err(err)
	}

	// ── Users ──

	pub async fn users_me(&self) -> std::result::Result<User, JsValue> {
		self.inner.users_me().await.map_err(err)
	}

	pub async fn users_resolve(
		&self,
		q: String,
	) -> std::result::Result<UserResolveResult, JsValue> {
		self.inner.users_resolve(&q).await.map_err(err)
	}

	pub async fn users_update_me(
		&self,
		data: JsValue,
	) -> std::result::Result<User, JsValue> {
		let body: serde_json::Value = from_jsv(data)?;
		self.inner.users_update_me(&body).await.map_err(err)
	}

	pub async fn dm_channels(&self) -> std::result::Result<Vec<DmChannelSummary>, JsValue> {
		self.inner.dm_channels().await.map_err(err)
	}

	pub async fn create_dm(
		&self,
		recipient_id: String,
		syr_instance_url: Option<String>,
	) -> std::result::Result<CreateDmResponse, JsValue> {
		self.inner
			.create_dm(&recipient_id, syr_instance_url.as_deref())
			.await
			.map_err(err)
	}

	// ── Relations ──

	pub async fn relations_snapshot(
		&self,
	) -> std::result::Result<RelationsSnapshot, JsValue> {
		self.inner.relations_snapshot().await.map_err(err)
	}

	pub async fn list_friends(
		&self,
		params: JsValue,
	) -> std::result::Result<PageFriendshipRow, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self.inner.list_friends(&p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn list_blocked(
		&self,
		params: JsValue,
	) -> std::result::Result<PageBlockedRow, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self.inner.list_blocked(&p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn list_ignored(
		&self,
		params: JsValue,
	) -> std::result::Result<PageIgnoredRow, JsValue> {
		let p: serde_json::Value = if params.is_undefined() || params.is_null() {
			serde_json::json!({})
		} else {
			from_jsv(params)?
		};
		let page = self.inner.list_ignored(&p).await.map_err(err)?;
		Ok(page.into())
	}

	pub async fn friend_send(
		&self,
		user_id: String,
		syr_instance_url: Option<String>,
	) -> std::result::Result<syren_types::Friendship, JsValue> {
		self.inner
			.friend_send(&user_id, syr_instance_url.as_deref())
			.await
			.map_err(err)
	}

	pub async fn friend_accept(
		&self,
		user_id: String,
	) -> std::result::Result<syren_types::Friendship, JsValue> {
		self.inner.friend_accept(&user_id).await.map_err(err)
	}

	pub async fn friend_decline(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.friend_decline(&user_id).await.map_err(err)
	}

	pub async fn friend_remove(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.friend_remove(&user_id).await.map_err(err)
	}

	pub async fn block(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.block(&user_id).await.map_err(err)
	}

	pub async fn unblock(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.unblock(&user_id).await.map_err(err)
	}

	pub async fn ignore(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.ignore(&user_id).await.map_err(err)
	}

	pub async fn unignore(
		&self,
		user_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner.unignore(&user_id).await.map_err(err)
	}

	// ── Voice ──

	pub async fn voice_token(
		&self,
		channel_id: String,
	) -> std::result::Result<VoiceTokenResponse, JsValue> {
		self.inner.voice_token(&channel_id).await.map_err(err)
	}

	// ── Uploads ──

	pub async fn upload_presign(
		&self,
		body: JsValue,
	) -> std::result::Result<UploadPresignResponse, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner.upload_presign(&body).await.map_err(err)
	}

	pub async fn upload_finalize(
		&self,
		upload_id: String,
		body: JsValue,
	) -> std::result::Result<UploadFinalizeResponse, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner
			.upload_finalize(&upload_id, &body)
			.await
			.map_err(err)
	}

	// ── Permission overrides ──

	pub async fn overrides_list(
		&self,
		server_id: String,
	) -> std::result::Result<Vec<PermissionOverride>, JsValue> {
		self.inner.overrides_list(&server_id).await.map_err(err)
	}

	pub async fn overrides_for_channel(
		&self,
		server_id: String,
		channel_id: String,
	) -> std::result::Result<Vec<PermissionOverride>, JsValue> {
		self.inner
			.overrides_for_channel(&server_id, &channel_id)
			.await
			.map_err(err)
	}

	pub async fn overrides_for_category(
		&self,
		server_id: String,
		category_id: String,
	) -> std::result::Result<Vec<PermissionOverride>, JsValue> {
		self.inner
			.overrides_for_category(&server_id, &category_id)
			.await
			.map_err(err)
	}

	pub async fn override_upsert(
		&self,
		server_id: String,
		body: JsValue,
	) -> std::result::Result<PermissionOverride, JsValue> {
		let body: serde_json::Value = from_jsv(body)?;
		self.inner
			.override_upsert(&server_id, &body)
			.await
			.map_err(err)
	}

	pub async fn override_delete(
		&self,
		server_id: String,
		override_id: String,
	) -> std::result::Result<SuccessResponse, JsValue> {
		self.inner
			.override_delete(&server_id, &override_id)
			.await
			.map_err(err)
	}
}

// ── Realtime (WS) ────────────────────────────────────────────────────
//
// `#[wasm_bindgen]` view over `crate::ws::RealtimeClient`. The TS
// adapter (`packages/ts/app-core/src/lib/stores/ws.svelte.ts`) keeps a
// single `Realtime` instance, registers an `on_frame` callback that
// dispatches to the existing `onWsEvent(op, handler)` listener map, and
// exposes the same `connectWs` / `disconnectWs` / `subscribeChannels`
// API to consumers. None of the per-store handlers change.

#[wasm_bindgen]
pub struct Realtime {
	inner: crate::ws::RealtimeClient,
}

#[wasm_bindgen]
impl Realtime {
	/// Build a `Realtime` from an existing `Client`. Reuses its base
	/// URL (rewritten to `ws/wss`) and its session store, so IDENTIFY
	/// always carries the same bearer the HTTP layer is using.
	#[wasm_bindgen(constructor)]
	pub fn new(client: &Client) -> Self {
		Self {
			inner: crate::ws::RealtimeClient::from_client(&client.inner),
		}
	}

	pub async fn connect(&self) {
		self.inner.connect().await;
	}

	pub async fn disconnect(&self) {
		self.inner.disconnect().await;
	}

	pub async fn send(&self, op: u32, d: JsValue) -> std::result::Result<(), JsValue> {
		let v: serde_json::Value = from_jsv(d)?;
		self.inner.send(op, v).await;
		Ok(())
	}

	pub async fn subscribe_channels(&self, channel_ids: Vec<String>) {
		self.inner.subscribe_channels(channel_ids).await;
	}

	pub async fn unsubscribe_channels(&self, channel_ids: Vec<String>) {
		self.inner.unsubscribe_channels(channel_ids).await;
	}

	pub async fn send_typing(&self, channel_id: String) {
		self.inner.send_typing(&channel_id).await;
	}

	/// Register a JS callback invoked once per incoming frame. The
	/// callback receives `(op: number, d: any)` — the consumer
	/// dispatches by `op` (matching `WsOp` from `@syren/types`).
	pub fn on_frame(&self, callback: js_sys::Function) {
		let cb = callback.clone();
		self.inner.on_frame(move |frame| {
			let serializer = serde_wasm_bindgen::Serializer::json_compatible();
			let d = frame
				.d
				.serialize(&serializer)
				.unwrap_or(JsValue::NULL);
			let op = JsValue::from_f64(frame.op as f64);
			let _ = cb.call2(&JsValue::NULL, &op, &d);
		});
	}

	/// Register a JS callback invoked on every state transition
	/// (Disconnected → Connecting → Connected → Identified → ...).
	/// The callback receives a string ('disconnected', 'connecting',
	/// 'connected', 'identified').
	pub fn on_state(&self, callback: js_sys::Function) {
		let cb = callback.clone();
		self.inner.on_state(move |state| {
			let s = match state {
				crate::ws::WsState::Disconnected => "disconnected",
				crate::ws::WsState::Connecting => "connecting",
				crate::ws::WsState::Connected => "connected",
				crate::ws::WsState::Identified => "identified",
			};
			let _ = cb.call1(&JsValue::NULL, &JsValue::from_str(s));
		});
	}
}

// Marker function — hangs onto a couple of imports we'd otherwise need
// to clutter `mod` declarations with conditional `#[allow(unused)]`s.
#[allow(dead_code)]
fn _kept() {
	let _ = ExchangeRequest {
		code: String::new(),
	};
	let _ = ExchangeResponse {
		session: String::new(),
	};
	let _ = (AllowDms::default(), AllowFriendRequests::default());
	let _: Vec<FriendshipRow> = Vec::new();
	let _: Vec<BlockedRow> = Vec::new();
	let _: Vec<IgnoredRow> = Vec::new();
	let _: Vec<MemberMessageEntry> = Vec::new();
	let _: Vec<TrashMessageEntry> = Vec::new();
}
