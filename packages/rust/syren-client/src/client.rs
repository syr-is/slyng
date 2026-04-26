use crate::error::{Error, Result};
use crate::session::{MemoryStore, SessionStore};
use crate::transport::Transport;
use std::sync::Arc;
use url::Url;

/// Top-level handle. One `Client` per app process; cheap to clone (the
/// inner state is `Arc`-wrapped).
#[derive(Clone)]
pub struct Client {
	pub(crate) transport: Arc<Transport>,
}

impl Client {
	/// `base` is the API host root, e.g. `https://app.slyng.gg`. Paths
	/// like `/auth/me` are resolved against `base + "/api"`.
	pub fn new(base: impl Into<String>) -> Result<Self> {
		Self::with_store(base, Arc::new(MemoryStore::new()))
	}

	pub fn with_store(base: impl Into<String>, store: Arc<dyn SessionStore>) -> Result<Self> {
		let base: Url = base.into().parse()?;
		Ok(Self {
			transport: Arc::new(Transport::new(base, store)?),
		})
	}

	pub fn base(&self) -> &Url {
		&self.transport.base
	}

	pub fn store(&self) -> Arc<dyn SessionStore> {
		self.transport.store.clone()
	}

	/// Generic untyped HTTP entry point — used by the Tauri proxy
	/// command so the JS-side `api.ts` can route every request
	/// through Rust without a per-method binding.
	pub async fn request_raw(
		&self,
		method: &str,
		path: &str,
		body: Option<serde_json::Value>,
	) -> Result<serde_json::Value> {
		let m = method.to_ascii_uppercase();
		let body = body.unwrap_or(serde_json::Value::Null);
		match m.as_str() {
			"GET" => self.transport.get(path).await,
			"DELETE" => self.transport.delete(path).await,
			"POST" => self.transport.post(path, &body).await,
			"PATCH" => self.transport.patch(path, &body).await,
			"PUT" => self.transport.put(path, &body).await,
			_ => Err(Error::Network(format!("unsupported method: {m}"))),
		}
	}
}
