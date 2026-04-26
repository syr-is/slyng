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
use syren_client::{Client, LoginResponse};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

pub const REDIRECT_URI: &str = "syren://auth/callback";
const OAUTH_WINDOW_LABEL: &str = "oauth";

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

	// If a previous attempt left the popup open (user closed it
	// without completing), reuse the slot. Otherwise build a fresh
	// child WebView window inside the app and load the consent URL
	// there. We never leave the app — the moment the popup tries to
	// navigate to `syren://auth/callback?code=…` the on_navigation
	// hook below intercepts it, completes login on the Rust side,
	// emits `auth-changed`, and closes the popup.
	if let Some(existing) = app.get_webview_window(OAUTH_WINDOW_LABEL) {
		let _ = existing.close();
	}

	let consent: url::Url = resp
		.consent_url
		.parse()
		.map_err(|e| format!("invalid consent URL: {e}"))?;
	let app_handle = app.clone();

	WebviewWindowBuilder::new(
		&app,
		OAUTH_WINDOW_LABEL,
		WebviewUrl::External(consent),
	)
	.title("Sign in with syr")
	.inner_size(480.0, 720.0)
	.on_navigation(move |url| {
		// Intercept the OAuth bridge URL the API redirects to after
		// token exchange (`syren://auth/callback?code=…`). We complete
		// login in Rust and tear down the popup. Returning `false`
		// cancels the actual cross-scheme navigation — we've handled it.
		let is_callback = url.scheme() == "syren"
			&& url.host_str() == Some("auth")
			&& url.path() == "/callback";
		if !is_callback {
			return true;
		}
		let code = url
			.query_pairs()
			.find(|(k, _)| k == "code")
			.map(|(_, v)| v.into_owned());
		let h = app_handle.clone();
		tauri::async_runtime::spawn(async move {
			let close_popup = || {
				if let Some(w) = h.get_webview_window(OAUTH_WINDOW_LABEL) {
					let _ = w.close();
				}
			};
			let Some(code) = code else {
				let _ = h.emit("auth-error", "missing bridge code on callback");
				close_popup();
				return;
			};
			let Some(client) = h.state::<ClientHandle>().current().await else {
				let _ = h.emit("auth-error", "no active client");
				close_popup();
				return;
			};
			match client.login_complete(code).await {
				Ok(identity) => {
					let _ = h.emit("auth-changed", &identity);
				}
				Err(e) => {
					let _ = h.emit("auth-error", &e.to_string());
				}
			}
			close_popup();
		});
		false
	})
	.build()
	.map_err(|e| e.to_string())?;

	Ok(resp)
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
