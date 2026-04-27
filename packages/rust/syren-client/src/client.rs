use crate::error::Result;
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
}
