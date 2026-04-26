//! OAuth orchestration on the native side.
//!
//! Two redirect strategies, picked by target:
//!
//! - **Desktop** (`tauri-plugin-oauth`): we spin up a localhost HTTP
//!   server on a random port for the duration of the handshake. The
//!   API receives `http://localhost:<port>/` as the redirect_uri,
//!   the system browser hits that URL after the OAuth callback's
//!   bounce, and the plugin's request handler calls us with the
//!   full URL (which carries the bridge `?code=…`).
//!
//! - **Mobile** (`tauri-plugin-deep-link`): we register `syren://`
//!   at the OS level. The API redirects to `syren://auth/callback?code=…`,
//!   the OS routes it into Tauri, and the deep-link plugin fires our
//!   on_open_url handler.
//!
//! Both code paths funnel into [`handle_callback_url`], which parses
//! the bridge code, calls `syren_client::login_complete`, persists
//! the session, and emits `auth-changed` for the JS-side login form.

use crate::session_store::TauriStoreSession;
use std::sync::Arc;
use syren_client::{Client, LoginResponse};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub const MOBILE_REDIRECT_URI: &str = "syren://auth/callback";

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

/// Pull the bridge `code` out of an OAuth callback URL, exchange it
/// for a real session via syren-client, and emit the result. Same
/// logic for desktop (loopback) and mobile (deep-link) paths.
pub fn handle_callback_url<R: Runtime>(app: &AppHandle<R>, url_str: &str) {
	// NOTE: `url_str` carries the OAuth bridge code in the query string.
	// Never log it (even at debug-build) — it'd land in journald /
	// logcat / Console.app where any process with log access could
	// race the exchange. Length-only diagnostics are below.
	let parsed = url::Url::parse(url_str).ok();
	let code = parsed.as_ref().and_then(|u| {
		u.query_pairs()
			.find(|(k, _)| k == "code")
			.map(|(_, v)| v.into_owned())
	});
	#[cfg(debug_assertions)]
	eprintln!(
		"[auth/callback] code present = {} (len={})",
		code.is_some(),
		code.as_deref().map(|s| s.len()).unwrap_or(0)
	);
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		let Some(code) = code else {
			#[cfg(debug_assertions)]
			eprintln!("[auth/callback] no code; emitting auth-error");
			let _ = app.emit("auth-error", "missing bridge code on callback");
			return;
		};
		let client = app.state::<ClientHandle>().current().await;
		#[cfg(debug_assertions)]
		eprintln!("[auth/callback] active client present = {}", client.is_some());
		let Some(client) = client else {
			let _ = app.emit("auth-error", "no active client");
			return;
		};
		match client.login_complete(code).await {
			Ok(identity) => {
				#[cfg(debug_assertions)]
				eprintln!("[auth/callback] login_complete OK");
				let _ = app.emit("auth-changed", &identity);
			}
			Err(e) => {
				#[cfg(debug_assertions)]
				eprintln!("[auth/callback] login_complete ERR = {e}");
				let _ = app.emit("auth-error", &e.to_string());
			}
		}
	});
}

#[tauri::command]
pub async fn start_login<R: Runtime>(
	app: AppHandle<R>,
	state: State<'_, ClientHandle>,
	api_host: String,
	instance_url: String,
) -> Result<LoginResponse, String> {
	let client = state.ensure(&app, &api_host).await?;

	// Build the platform-appropriate redirect_uri before kicking off
	// the OAuth handshake. On mobile this is the registered deep
	// link; on desktop it's a freshly bound loopback port.
	let redirect_uri = build_redirect_uri(&app)?;

	let resp = client
		.login_start(instance_url, Some(redirect_uri))
		.await
		.map_err(|e| e.to_string())?;

	app.opener()
		.open_url(resp.consent_url.clone(), None::<&str>)
		.map_err(|e| e.to_string())?;

	Ok(resp)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn build_redirect_uri<R: Runtime>(_app: &AppHandle<R>) -> Result<String, String> {
	Ok(MOBILE_REDIRECT_URI.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_redirect_uri<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
	let app_clone = app.clone();
	let port = tauri_plugin_oauth::start(move |url| {
		handle_callback_url(&app_clone, &url);
	})
	.map_err(|e| e.to_string())?;
	Ok(format!("http://localhost:{port}/"))
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
