//! Thin Tauri command wrappers around `syren_client::Client` methods.
//! Each command delegates to the shared `ClientHandle` (built lazily
//! when `start_login` runs, or rebuilt by `set_host` on app restart).

use crate::auth::ClientHandle;
use serde_json::Value;
use syren_client::Identity;
use tauri::{AppHandle, Runtime, State};

async fn client<R: Runtime>(
	app: &AppHandle<R>,
	state: &State<'_, ClientHandle>,
	api_host: &str,
) -> Result<syren_client::Client, String> {
	state.ensure(app, api_host).await
}

/// Generic proxy — every API call from the native shell flows through
/// here. JS-side `app-core/api.ts` is configured with a transport that
/// invokes `proxy_request` for every request; the underlying HTTP
/// happens entirely in Rust (`syren-client::Client::request_raw` →
/// reqwest with persistent cookies + the session id from the Tauri
/// store). No bearer / cookie ever crosses the JS boundary.
#[tauri::command]
pub async fn proxy_request<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	path: String,
	method: Option<String>,
	body: Option<Value>,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.request_raw(method.as_deref().unwrap_or("GET"), &path, body)
		.await
		.map_err(|e| e.to_string())
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
) -> Result<Vec<Value>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.servers_list().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_get<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_get(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<Value>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.server_channels(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn server_members<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Vec<Value>, String> {
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
) -> Result<Vec<Value>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_messages(&id, before.as_deref(), limit)
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
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_send(&id, &body).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn channel_typing<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	id: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.channel_typing(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn users_me<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.users_me().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dm_channels<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Vec<Value>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.dm_channels().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn roles_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<Value>, String> {
	let c = client(&app, &state, &api_host).await?;
	c.roles_list(&server_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn my_permissions<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.my_permissions(&server_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn categories_list<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	server_id: String,
) -> Result<Vec<Value>, String> {
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
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.relations_snapshot().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invite_preview<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_preview(&code).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invite_join<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	code: String,
) -> Result<Value, String> {
	let c = client(&app, &state, &api_host).await?;
	c.invite_join(&code).await.map_err(|e| e.to_string())
}
