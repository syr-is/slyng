use crate::client::Client;
use crate::error::Result;
use serde_json::{json, Value as Json};
use syren_types::{CreateDmResponse, DmChannelSummary, User, UserResolveResult};

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn users_me(&self) -> Result<User> {
		self.transport.get("/users/@me").await
	}

	pub async fn users_resolve(&self, q: &str) -> Result<UserResolveResult> {
		self.transport
			.get(&format!("/users/resolve?q={}", enc(q)))
			.await
	}

	pub async fn users_update_me(&self, data: &Json) -> Result<User> {
		self.transport.patch("/users/@me", data).await
	}

	pub async fn dm_channels(&self) -> Result<Vec<DmChannelSummary>> {
		self.transport.get("/users/@me/channels").await
	}

	pub async fn create_dm(
		&self,
		recipient_id: &str,
		syr_instance_url: Option<&str>,
	) -> Result<CreateDmResponse> {
		let body = json!({
			"recipient_id": recipient_id,
			"syr_instance_url": syr_instance_url,
		});
		self.transport.post("/users/@me/channels", &body).await
	}
}
