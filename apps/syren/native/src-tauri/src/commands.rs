//! Thin Tauri command wrappers around `syren_client::Client` methods.
//! Each command delegates to the shared `ClientHandle` (built lazily
//! when `start_login` runs, or rebuilt by `set_host` on app restart).
//!
//! Every command returns the typed struct from `syren-types` directly —
//! Tauri's IPC layer serialises through serde to JS, so the WebView
//! receives plain typed objects (same shape the WASM build emits on
//! web). No more `Value` round-trips through this layer.

use crate::auth::ClientHandle;
use serde_json::Value;
use syren_client::Identity;
use syren_types::{
	Channel, ChannelCategory, DmChannelSummary, InviteJoinResponse, InvitePreview, Message,
	MyPermissions, RelationsSnapshot, Server, ServerMember, ServerRole, SuccessResponse, User,
};
use tauri::{AppHandle, Runtime, State};

async fn client<R: Runtime>(
	app: &AppHandle<R>,
	state: &State<'_, ClientHandle>,
	api_host: &str,
) -> Result<syren_client::Client, String> {
	state.ensure(app, api_host).await
}

/// Expose the persisted session id to JS so the WebSocket layer can
/// send a syr `IDENTIFY` message after connect — the WS lives at
/// `app.slyng.gg` while the Tauri WebView origin is `tauri.localhost`,
/// so cookies don't cross and the server's cookie auto-identify path
/// (chat.gateway.ts:67-78) can never fire on native. The token already
/// rides the JS↔Rust trust boundary via every `proxy_request`, so this
/// just surfaces the same value once for the WS handshake.
#[tauri::command]
pub async fn session_token<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Option<String>, String> {
	let c = client(&app, &state, &api_host).await?;
	Ok(c.store().get().await)
}

/// Generic untyped escape hatch for endpoints that haven't been migrated
/// yet. Phase 8 of the typed-client refactor will delete this — every
/// caller should use a typed command below instead.
#[tauri::command]
pub async fn proxy_request<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	path: String,
	method: Option<String>,
	body: Option<Value>,
) -> Result<Value, String> {
	let m = method.as_deref().unwrap_or("GET").to_string();
	#[cfg(debug_assertions)]
	eprintln!("[proxy] -> {m} {path}");
	let c = client(&app, &state, &api_host).await?;
	let result = c.request_raw(&m, &path, body).await;
	#[cfg(debug_assertions)]
	match &result {
		Ok(_) => eprintln!("[proxy] <- {m} {path} OK"),
		Err(e) => eprintln!("[proxy] <- {m} {path} ERR = {e}"),
	}
	result.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Identity, String> {
	let c = client(&app, &state, &api_host).await?;
	c.me().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn servers_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Vec<Server>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.servers_list().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_get<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Server, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_get(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<Channel>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_channels(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_members<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<ServerMember>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_members(&id).await.map_err(|e| e.to_string())
}

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
		.map_err(|e| e.to_string())
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
	c.channel_send(&id, &body).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn channel_typing<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<SuccessResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_typing(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn users_me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<User, String> {
	let c = client(&app, &state, &api_host).await?;
	c.users_me().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dm_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Vec<DmChannelSummary>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.dm_channels().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn roles_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<ServerRole>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.roles_list(&server_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn my_permissions<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<MyPermissions, String> {
	let c = client(&app, &state, &api_host).await?;
	c.my_permissions(&server_id)
		.await
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn categories_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<ChannelCategory>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.categories_list(&server_id)
		.await
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn relations_snapshot<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<RelationsSnapshot, String> {
	let c = client(&app, &state, &api_host).await?;
	c.relations_snapshot()
		.await
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invite_preview<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<InvitePreview, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_preview(&code)
		.await
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invite_join<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<InviteJoinResponse, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_join(&code).await.map_err(|e| e.to_string())
}
