use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn overrides_list(&self, server_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/overrides", enc(server_id)))
			.await
	}

	pub async fn overrides_for_channel(&self, server_id: &str, channel_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!(
				"/servers/{}/overrides/channel/{}",
				enc(server_id),
				enc(channel_id)
			))
			.await
	}

	pub async fn overrides_for_category(&self, server_id: &str, category_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!(
				"/servers/{}/overrides/category/{}",
				enc(server_id),
				enc(category_id)
			))
			.await
	}

	pub async fn override_upsert(&self, server_id: &str, body: &Json) -> Result<Json> {
		self.transport
			.put(&format!("/servers/{}/overrides", enc(server_id)), body)
			.await
	}

	pub async fn override_delete(&self, server_id: &str, override_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!(
				"/servers/{}/overrides/{}",
				enc(server_id),
				enc(override_id)
			))
			.await
	}
}
