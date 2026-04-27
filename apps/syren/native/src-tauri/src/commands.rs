//! Tauri command wrappers — one per public method on `syren_client::Client`.
//!
//! Every command pattern is the same: build (or reuse) the lazy
//! `syren_client::Client` for `api_host`, forward the call, return the
//! typed struct from `syren-types`. Tauri's IPC layer serialises the
//! struct through serde so the JS side receives a plain object whose
//! shape matches `@syren/client/wasm`'s `.d.ts`.
//!
//! No more `Value` round-trips — every endpoint is typed end-to-end.

use crate::auth::ClientHandle;
use serde_json::Value;
use syren_client::Identity;
use syren_types::{
	BlockedRow, Channel, ChannelCategory, CreateDmResponse, CreateInviteResponse,
	DmChannelSummary, Friendship, FriendshipRow, IgnoredRow, InviteJoinResponse, InvitePreview,
	MemberMessageStats, MemberPermissionsView, Message, MyPermissions, PageAuditLog,
	PageBlockedRow, PageFriendshipRow, PageIgnoredRow, PageMemberMessageEntry, PageServerBan,
	PageServerInvite, PageServerMember, PageTrashMessageEntry, PaginatedQuery,
	PermissionOverride, PermissionTree, RelationsSnapshot, Server, ServerBan, ServerInvite,
	ServerMember, ServerRole, SuccessResponse, TransferOwnershipResponse, TrashChannelEntry,
	TrashMessageEntry, TrashRoleEntry, UploadFinalizeResponse, UploadPresignResponse, User,
	UserResolveResult, VoiceTokenResponse,
};
use tauri::{AppHandle, Runtime, State};

async fn client<R: Runtime>(
	app: &AppHandle<R>,
	state: &State<'_, ClientHandle>,
	api_host: &str,
) -> Result<syren_client::Client, String> {
	state.ensure(app, api_host).await
}

fn err<E: std::fmt::Display>(e: E) -> String {
	e.to_string()
}

// ── Session / auth (read-side; login_start lives in `auth.rs`) ──────────

#[tauri::command]
pub async fn session_token<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Option<String>, String> {
	let c = client(&app, &state, &api_host).await?;
	Ok(c.store().get().await)
}

#[tauri::command]
pub async fn me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Identity, String> {
	let c = client(&app, &state, &api_host).await?;
	c.me().await.map_err(err)
}

#[tauri::command]
pub async fn login_complete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<Identity, String> {
	let c = client(&app, &state, &api_host).await?;
	c.login_complete(code).await.map_err(err)
}

// ── Servers ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn servers_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Vec<Server>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.servers_list().await.map_err(err)
}

#[tauri::command]
pub async fn server_get<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Server, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_get(&id).await.map_err(err)
}

#[tauri::command]
pub async fn server_create<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	data: Value,
) -> Result<Server, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_create(&data).await.map_err(err)
}

#[tauri::command]
pub async fn server_update<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	data: Value,
) -> Result<Server, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_update(&id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn server_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_delete(&id).await.map_err(err)
}

#[tauri::command]
pub async fn server_leave<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_leave(&id).await.map_err(err)
}

#[tauri::command]
pub async fn server_transfer_ownership<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	new_owner_id: String,
) -> Result<TransferOwnershipResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_transfer_ownership(&id, &new_owner_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn server_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<Channel>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_channels(&id).await.map_err(err)
}

#[tauri::command]
pub async fn server_members<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<ServerMember>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_members(&id).await.map_err(err)
}

#[tauri::command]
pub async fn server_members_page<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	params: PaginatedQuery,
) -> Result<PageServerMember, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.server_members_page(&id, &params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn server_voice_states<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Value, String> {
	// VoiceStatesByChannel = HashMap<String, Vec<VoiceState>>; surface as
	// a plain JSON object so the JS side can index by channel id without
	// a Map wrapper.
	let c = client(&app, &state, &api_host).await?;
	let states = c.server_voice_states(&id).await.map_err(err)?;
	serde_json::to_value(&states).map_err(err)
}

#[tauri::command]
pub async fn server_create_channel<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	data: Value,
) -> Result<Channel, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_create_channel(&id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn member_kick<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	delete_seconds: Option<u32>,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.member_kick(&server_id, &user_id, delete_seconds)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn member_ban<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	body: Value,
) -> Result<ServerBan, String> {
	let c = client(&app, &state, &api_host).await?;
	c.member_ban(&server_id, &body).await.map_err(err)
}

#[tauri::command]
pub async fn member_unban<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.member_unban(&server_id, &user_id).await.map_err(err)
}

#[tauri::command]
pub async fn list_bans<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	params: Value,
) -> Result<PageServerBan, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.list_bans(&server_id, &params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn member_messages<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	params: Value,
) -> Result<PageMemberMessageEntry, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c
		.member_messages(&server_id, &user_id, &params)
		.await
		.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn member_message_stats<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
) -> Result<MemberMessageStats, String> {
	let c = client(&app, &state, &api_host).await?;
	c.member_message_stats(&server_id, &user_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn purge_member_messages<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	body: Value,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.purge_member_messages(&server_id, &user_id, &body)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn member_ban_history<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
) -> Result<Vec<ServerBan>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.member_ban_history(&server_id, &user_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn audit_log<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	params: Value,
) -> Result<PageAuditLog, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.audit_log(&server_id, &params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn member_audit_log<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	params: Value,
) -> Result<PageAuditLog, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c
		.member_audit_log(&server_id, &user_id, &params)
		.await
		.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn invites_create<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	data: Value,
) -> Result<CreateInviteResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invites_create(&server_id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn invites_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	params: PaginatedQuery,
) -> Result<PageServerInvite, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.invites_list(&server_id, &params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn invite_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	code: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_delete(&server_id, &code).await.map_err(err)
}

#[tauri::command]
pub async fn update_invite<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	code: String,
	data: Value,
) -> Result<ServerInvite, String> {
	let c = client(&app, &state, &api_host).await?;
	c.update_invite(&server_id, &code, &data)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn trash_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<TrashChannelEntry>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.trash_channels(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn trash_roles<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<TrashRoleEntry>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.trash_roles(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn trash_messages<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	params: Value,
) -> Result<PageTrashMessageEntry, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.trash_messages(&server_id, &params).await.map_err(err)?;
	Ok(page.into())
}

// ── Invites (top-level, code-keyed) ─────────────────────────────────────

#[tauri::command]
pub async fn invite_preview<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<InvitePreview, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_preview(&code).await.map_err(err)
}

#[tauri::command]
pub async fn invite_join<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<InviteJoinResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_join(&code).await.map_err(err)
}

// ── Roles ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn roles_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<ServerRole>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.roles_list(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn role_create<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	data: Value,
) -> Result<ServerRole, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_create(&server_id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn role_update<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	role_id: String,
	data: Value,
) -> Result<ServerRole, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_update(&role_id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn role_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	role_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_delete(&role_id).await.map_err(err)
}

#[tauri::command]
pub async fn role_swap<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	role_id: String,
	other_role_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_swap(&role_id, &other_role_id).await.map_err(err)
}

#[tauri::command]
pub async fn role_reorder<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	role_ids: Vec<String>,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_reorder(&server_id, &role_ids).await.map_err(err)
}

#[tauri::command]
pub async fn role_assign<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	role_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_assign(&server_id, &user_id, &role_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn role_unassign<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
	role_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_unassign(&server_id, &user_id, &role_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn my_permissions<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<MyPermissions, String> {
	let c = client(&app, &state, &api_host).await?;
	c.my_permissions(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn role_permission_tree<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
) -> Result<PermissionTree, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_permission_tree(&server_id, &user_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn role_member_permissions<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	user_id: String,
) -> Result<MemberPermissionsView, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_member_permissions(&server_id, &user_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn role_restore<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	role_id: String,
) -> Result<ServerRole, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_restore(&role_id).await.map_err(err)
}

#[tauri::command]
pub async fn role_hard_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	role_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.role_hard_delete(&role_id).await.map_err(err)
}

// ── Channels (messages, pins, reactions, lifecycle) ─────────────────────

#[tauri::command]
pub async fn channel_messages<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	before: Option<String>,
	limit: Option<u32>,
	include_deleted: Option<bool>,
) -> Result<Vec<Message>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_messages(&id, before.as_deref(), limit, include_deleted)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_send<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	body: Value,
) -> Result<Message, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_send(&id, &body).await.map_err(err)
}

#[tauri::command]
pub async fn channel_edit_message<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
	content: String,
) -> Result<Message, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_edit_message(&channel_id, &message_id, &content)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_delete_message<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_delete_message(&channel_id, &message_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_clear_embeds<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<Message, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_clear_embeds(&channel_id, &message_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_add_reaction<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
	kind: String,
	value: String,
) -> Result<Message, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_add_reaction(&channel_id, &message_id, &kind, &value)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_pins<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	include_deleted: Option<bool>,
) -> Result<Vec<Message>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_pins(&id, include_deleted).await.map_err(err)
}

#[tauri::command]
pub async fn channel_pin<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_pin(&channel_id, &message_id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_unpin<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_unpin(&channel_id, &message_id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_typing<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_typing(&id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_update<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
	data: Value,
) -> Result<Channel, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_update(&id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn channel_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_delete(&id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_restore<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Channel, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_restore(&id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_hard_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_hard_delete(&id).await.map_err(err)
}

#[tauri::command]
pub async fn channel_restore_message<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<Message, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_restore_message(&channel_id, &message_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_hard_delete_message<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
	message_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_hard_delete_message(&channel_id, &message_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn channel_reorder<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	body: Value,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_reorder(&server_id, &body).await.map_err(err)
}

// ── Categories ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn categories_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<ChannelCategory>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.categories_list(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn category_create<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	name: String,
) -> Result<ChannelCategory, String> {
	let c = client(&app, &state, &api_host).await?;
	c.category_create(&server_id, &name).await.map_err(err)
}

#[tauri::command]
pub async fn category_update<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	category_id: String,
	data: Value,
) -> Result<ChannelCategory, String> {
	let c = client(&app, &state, &api_host).await?;
	c.category_update(&category_id, &data).await.map_err(err)
}

#[tauri::command]
pub async fn category_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	category_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.category_delete(&category_id).await.map_err(err)
}

#[tauri::command]
pub async fn category_swap<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	a: String,
	b: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.category_swap(&a, &b).await.map_err(err)
}

#[tauri::command]
pub async fn category_reorder<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	category_ids: Vec<String>,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.category_reorder(&server_id, &category_ids)
		.await
		.map_err(err)
}

// ── Users ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn users_me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<User, String> {
	let c = client(&app, &state, &api_host).await?;
	c.users_me().await.map_err(err)
}

#[tauri::command]
pub async fn users_resolve<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	q: String,
) -> Result<UserResolveResult, String> {
	let c = client(&app, &state, &api_host).await?;
	c.users_resolve(&q).await.map_err(err)
}

#[tauri::command]
pub async fn users_update_me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	data: Value,
) -> Result<User, String> {
	let c = client(&app, &state, &api_host).await?;
	c.users_update_me(&data).await.map_err(err)
}

#[tauri::command]
pub async fn dm_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Vec<DmChannelSummary>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.dm_channels().await.map_err(err)
}

#[tauri::command]
pub async fn create_dm<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	recipient_id: String,
	syr_instance_url: Option<String>,
) -> Result<CreateDmResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.create_dm(&recipient_id, syr_instance_url.as_deref())
		.await
		.map_err(err)
}

// ── Relations ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn relations_snapshot<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<RelationsSnapshot, String> {
	let c = client(&app, &state, &api_host).await?;
	c.relations_snapshot().await.map_err(err)
}

#[tauri::command]
pub async fn list_friends<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	params: Value,
) -> Result<PageFriendshipRow, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.list_friends(&params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn list_blocked<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	params: Value,
) -> Result<PageBlockedRow, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.list_blocked(&params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn list_ignored<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	params: Value,
) -> Result<PageIgnoredRow, String> {
	let c = client(&app, &state, &api_host).await?;
	let page = c.list_ignored(&params).await.map_err(err)?;
	Ok(page.into())
}

#[tauri::command]
pub async fn friend_send<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
	syr_instance_url: Option<String>,
) -> Result<Friendship, String> {
	let c = client(&app, &state, &api_host).await?;
	c.friend_send(&user_id, syr_instance_url.as_deref())
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn friend_accept<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<Friendship, String> {
	let c = client(&app, &state, &api_host).await?;
	c.friend_accept(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn friend_decline<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.friend_decline(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn friend_remove<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.friend_remove(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn block<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.block(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn unblock<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.unblock(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn ignore<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.ignore(&user_id).await.map_err(err)
}

#[tauri::command]
pub async fn unignore<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	user_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.unignore(&user_id).await.map_err(err)
}

// ── Voice / uploads / overrides ─────────────────────────────────────────

#[tauri::command]
pub async fn voice_token<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	channel_id: String,
) -> Result<VoiceTokenResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.voice_token(&channel_id).await.map_err(err)
}

#[tauri::command]
pub async fn upload_presign<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	body: Value,
) -> Result<UploadPresignResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.upload_presign(&body).await.map_err(err)
}

#[tauri::command]
pub async fn upload_finalize<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	upload_id: String,
	body: Value,
) -> Result<UploadFinalizeResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.upload_finalize(&upload_id, &body).await.map_err(err)
}

#[tauri::command]
pub async fn overrides_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<PermissionOverride>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.overrides_list(&server_id).await.map_err(err)
}

#[tauri::command]
pub async fn overrides_for_channel<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	channel_id: String,
) -> Result<Vec<PermissionOverride>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.overrides_for_channel(&server_id, &channel_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn overrides_for_category<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	category_id: String,
) -> Result<Vec<PermissionOverride>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.overrides_for_category(&server_id, &category_id)
		.await
		.map_err(err)
}

#[tauri::command]
pub async fn override_upsert<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	body: Value,
) -> Result<PermissionOverride, String> {
	let c = client(&app, &state, &api_host).await?;
	c.override_upsert(&server_id, &body).await.map_err(err)
}

#[tauri::command]
pub async fn override_delete<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
	override_id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.override_delete(&server_id, &override_id)
		.await
		.map_err(err)
}

// Suppress unused-import warning for `BlockedRow`/`FriendshipRow`/`IgnoredRow` —
// the typed `PageX` wrappers carry them transitively, but the inner types
// are only referenced through `Page<X>::into()` calls that the compiler can't
// see as a use of the type's name. (Rust's import resolution is stricter
// than its monomorphisation.)
#[allow(dead_code)]
fn _ensure_inner_types_in_scope(
	_b: BlockedRow,
	_f: FriendshipRow,
	_i: IgnoredRow,
	_t: TrashMessageEntry,
	_e: syren_types::MemberMessageEntry,
) {
}
