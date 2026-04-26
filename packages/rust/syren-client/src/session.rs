use async_trait::async_trait;
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use tokio::sync::RwLock;

#[cfg(target_arch = "wasm32")]
use std::sync::RwLock;

/// Where the syren session token lives. Rust callers (Tauri) plug in a
/// store backed by `tauri-plugin-store`; the WASM/web caller uses
/// `LocalStorageStore`. Default in-memory variant is provided for tests
/// and for transient flows.
#[async_trait(?Send)]
pub trait SessionStore: Sync + Send {
	async fn get(&self) -> Option<String>;
	async fn set(&self, session_id: &str);
	async fn clear(&self);
}

/// Simple in-memory store. Lost when the process exits.
#[derive(Default, Clone)]
pub struct MemoryStore {
	inner: Arc<RwLock<Option<String>>>,
}

impl MemoryStore {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn with(value: Option<String>) -> Self {
		Self {
			inner: Arc::new(RwLock::new(value)),
		}
	}
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait(?Send)]
impl SessionStore for MemoryStore {
	async fn get(&self) -> Option<String> {
		self.inner.read().await.clone()
	}
	async fn set(&self, session_id: &str) {
		*self.inner.write().await = Some(session_id.to_string());
	}
	async fn clear(&self) {
		*self.inner.write().await = None;
	}
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl SessionStore for MemoryStore {
	async fn get(&self) -> Option<String> {
		self.inner.read().ok().and_then(|g| g.clone())
	}
	async fn set(&self, session_id: &str) {
		if let Ok(mut g) = self.inner.write() {
			*g = Some(session_id.to_string());
		}
	}
	async fn clear(&self) {
		if let Ok(mut g) = self.inner.write() {
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

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
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
