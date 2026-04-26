//! `SessionStore` impl backed by tauri-plugin-store. Persists across
//! app restarts in the OS-managed app data directory.

use async_trait::async_trait;
use serde_json::Value;
use syren_client::SessionStore;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "config.json";
const KEY: &str = "syren_session";

pub struct TauriStoreSession<R: Runtime> {
	app: AppHandle<R>,
}

impl<R: Runtime> TauriStoreSession<R> {
	pub fn new(app: AppHandle<R>) -> Self {
		Self { app }
	}

	fn store_get(&self) -> Option<String> {
		let v = self.app.store(STORE_FILE).ok().and_then(|s| match s.get(KEY) {
			Some(Value::String(s)) => Some(s),
			_ => None,
		});
		#[cfg(debug_assertions)]
		eprintln!("[store] get -> present={}", v.is_some());
		v
	}

	fn store_set(&self, value: &str) {
		if let Ok(store) = self.app.store(STORE_FILE) {
			store.set(KEY, Value::String(value.to_string()));
			let saved = store.save();
			#[cfg(debug_assertions)]
			eprintln!("[store] set save_ok={}", saved.is_ok());
			let _ = saved;
		} else {
			#[cfg(debug_assertions)]
			eprintln!("[store] set FAILED to open store");
		}
	}

	fn store_clear(&self) {
		if let Ok(store) = self.app.store(STORE_FILE) {
			store.delete(KEY);
			let _ = store.save();
			#[cfg(debug_assertions)]
			eprintln!("[store] clear done");
		}
	}
}

#[async_trait]
impl<R: Runtime> SessionStore for TauriStoreSession<R> {
	async fn get(&self) -> Option<String> {
		self.store_get()
	}
	async fn set(&self, session_id: &str) {
		self.store_set(session_id);
	}
	async fn clear(&self) {
		self.store_clear();
	}
}
