use async_trait::async_trait;
use std::sync::{Arc, Mutex};

/// Where the syren session token lives. Native Tauri plugs in an impl
/// backed by `tauri-plugin-store`; the WASM/web caller uses
/// `LocalStorageStore`. Default in-memory variant is provided for tests
/// and for transient flows.
///
/// We use `std::sync::Mutex` so the `Send + Sync` bound holds on
/// every target — Tauri commands require `Send` futures, and on WASM
/// the lock contention is irrelevant (single-threaded event loop).
#[async_trait]
pub trait SessionStore: Sync + Send {
	async fn get(&self) -> Option<String>;
	async fn set(&self, session_id: &str);
	async fn clear(&self);
}

/// Simple in-memory store. Lost when the process exits.
#[derive(Default, Clone)]
pub struct MemoryStore {
	inner: Arc<Mutex<Option<String>>>,
}

impl MemoryStore {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn with(value: Option<String>) -> Self {
		Self {
			inner: Arc::new(Mutex::new(value)),
		}
	}
}

#[async_trait]
impl SessionStore for MemoryStore {
	async fn get(&self) -> Option<String> {
		self.inner.lock().ok().and_then(|g| g.clone())
	}
	async fn set(&self, session_id: &str) {
		if let Ok(mut g) = self.inner.lock() {
			*g = Some(session_id.to_string());
		}
	}
	async fn clear(&self) {
		if let Ok(mut g) = self.inner.lock() {
			*g = None;
		}
	}
}

/// WASM-only: persists in `localStorage`. Reads on demand so multiple
/// tabs / page loads see the same value.
#[cfg(target_arch = "wasm32")]
pub struct LocalStorageStore {
	key: String,
}

#[cfg(target_arch = "wasm32")]
impl LocalStorageStore {
	pub fn new(key: impl Into<String>) -> Self {
		Self { key: key.into() }
	}

	fn ls() -> Option<web_sys::Storage> {
		web_sys::window()?.local_storage().ok().flatten()
	}
}

// Safety: WASM is single-threaded; web_sys handles aren't Send, but
// we never actually move them across threads.
#[cfg(target_arch = "wasm32")]
unsafe impl Send for LocalStorageStore {}
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for LocalStorageStore {}

#[cfg(target_arch = "wasm32")]
#[async_trait]
impl SessionStore for LocalStorageStore {
	async fn get(&self) -> Option<String> {
		Self::ls()?.get_item(&self.key).ok().flatten()
	}
	async fn set(&self, session_id: &str) {
		if let Some(s) = Self::ls() {
			let _ = s.set_item(&self.key, session_id);
		}
	}
	async fn clear(&self) {
		if let Some(s) = Self::ls() {
			let _ = s.remove_item(&self.key);
		}
	}
}
