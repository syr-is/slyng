//! OAuth orchestration on the native side.
//!
//! Flow:
//!   1. JS `client.auth.startLogin(instanceUrl)` → invoke('start_login', ...).
//!      Rust calls `syren_client::login_start` with `redirect=syren://auth/callback`,
//!      gets a `consent_url`, opens it in the system browser via tauri-plugin-shell.
//!   2. User consents on their syr instance.
//!   3. syr.is redirects to https://<api>/api/auth/callback?...
//!   4. The API completes the OAuth handshake, then 302/HTML-bounces to
//!      `syren://auth/callback?code=<one-shot>` (we'll add the bridge endpoint
//!      in Phase 9).
//!   5. The OS routes that URL into the Tauri app via tauri-plugin-deep-link.
//!   6. Our deep-link handler invokes `complete_login(code)` →
//!      `syren_client::login_complete` swaps the bridge code for a session id,
//!      stores it, fetches `/auth/me`, emits `auth-changed` to the frontend.

use crate::session_store::TauriStoreSession;
use std::sync::Arc;
use syren_client::{Client, Identity, LoginResponse};
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

pub const REDIRECT_URI: &str = "syren://auth/callback";

/// Process-wide handle. Built once `start_login` is called or as soon
/// as the user supplies a host on first run.
pub struct ClientHandle {
	inner: Mutex<Option<Client>>,
}

impl ClientHandle {
	pub fn new() -> Self {
		Self {
			inner: Mutex::new(None),
		}
	}

	pub async fn ensure<R: Runtime>(&self, app: &AppHandle<R>, base: &str) -> Result<Client, String> {
		let mut guard = self.inner.lock().await;
		if let Some(c) = guard.as_ref() {
			if c.base().as_str().trim_end_matches('/') == base.trim_end_matches('/') {
				return Ok(c.clone());
			}
		}
		let store = Arc::new(TauriStoreSession::new(app.clone()));
		let client = Client::with_store(base, store).map_err(|e| e.to_string())?;
		*guard = Some(client.clone());
		Ok(client)
	}

	pub async fn current(&self) -> Option<Client> {
		self.inner.lock().await.clone()
	}
}

#[tauri::command]
pub async fn start_login<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	instance_url: String,
) -> Result<LoginResponse, String> {
	let client = state.ensure(&app, &api_host).await?;
	let resp = client
		.login_start(instance_url, Some(REDIRECT_URI.to_string()))
		.await
		.map_err(|e| e.to_string())?;

	// Open consent in the system browser. The user finishes there; the
	// callback comes back via the syren:// deep link.
	app.opener()
		.open_url(resp.consent_url.clone(), None::<&str>)
		.map_err(|e| e.to_string())?;

	Ok(resp)
}

#[tauri::command]
pub async fn complete_login<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	code: String,
) -> Result<Identity, String> {
	let client = state
		.current()
		.await
		.ok_or_else(|| "client not initialised; start_login must be called first".to_string())?;
	let identity = client
		.login_complete(code)
		.await
		.map_err(|e| e.to_string())?;
	let token = client.store().get().await;
	app.emit(
		"auth-changed",
		&serde_json::json!({ "identity": identity, "token": token }),
	)
	.ok();
	Ok(identity)
}

/// Returns the persisted bearer token if the user is signed in, so the
/// JS side can populate `app-core/host.ts::setBearerToken` on boot
/// before the first `/auth/me` fires.
#[tauri::command]
pub async fn get_session_token<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
) -> Result<Option<String>, String> {
	let client = state.ensure(&app, &api_host).await?;
	Ok(client.store().get().await)
}

#[tauri::command]
pub async fn logout<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
) -> Result<(), String> {
	if let Some(client) = state.current().await {
		client.logout().await.map_err(|e| e.to_string())?;
	}
	app.emit("auth-changed", serde_json::Value::Null).ok();
	Ok(())
}
