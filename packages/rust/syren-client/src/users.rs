use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn users_me(&self) -> Result<Json> {
		self.transport.get("/users/@me").await
	}

	pub async fn users_resolve(&self, q: &str) -> Result<Json> {
		self.transport
			.get(&format!("/users/resolve?q={}", enc(q)))
			.await
	}

	pub async fn users_update_me(&self, data: &Json) -> Result<Json> {
		self.transport.patch("/users/@me", data).await
	}

	pub async fn dm_channels(&self) -> Result<Vec<Json>> {
		self.transport.get("/users/@me/channels").await
	}

	pub async fn create_dm(&self, recipient_id: &str, syr_instance_url: Option<&str>) -> Result<Json> {
		let body = serde_json::json!({
			"recipient_id": recipient_id,
			"syr_instance_url": syr_instance_url,
		});
		self.transport.post("/users/@me/channels", &body).await
	}
}
