use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn categories_list(&self, server_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/categories", enc(server_id)))
			.await
	}

	pub async fn category_create(&self, server_id: &str, name: &str) -> Result<Json> {
		self.transport
			.post(
				&format!("/servers/{}/categories", enc(server_id)),
				&serde_json::json!({ "name": name }),
			)
			.await
	}

	pub async fn category_update(&self, category_id: &str, data: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/categories/{}", enc(category_id)), data)
			.await
	}

	pub async fn category_delete(&self, category_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!("/categories/{}", enc(category_id)))
			.await
	}

	pub async fn category_reorder(&self, server_id: &str, ids: &[String]) -> Result<Json> {
		self.transport
			.post(
				&format!("/servers/{}/categories/reorder", enc(server_id)),
				&serde_json::json!({ "categoryIds": ids }),
			)
			.await
	}

	pub async fn category_swap(&self, a: &str, b: &str) -> Result<Json> {
		self.transport
			.post(
				&format!("/categories/{}/swap/{}", enc(a), enc(b)),
				&serde_json::json!({}),
			)
			.await
	}
}
