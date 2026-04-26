use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn roles_list(&self, server_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/roles", enc(server_id)))
			.await
	}

	pub async fn role_create(&self, server_id: &str, data: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/servers/{}/roles", enc(server_id)), data)
			.await
	}

	pub async fn role_update(&self, role_id: &str, data: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/roles/{}", enc(role_id)), data)
			.await
	}

	pub async fn role_delete(&self, role_id: &str) -> Result<Json> {
		self.transport.delete(&format!("/roles/{}", enc(role_id))).await
	}

	pub async fn role_assign(&self, server_id: &str, user_id: &str, role_id: &str) -> Result<Json> {
		self.transport
			.post(
				&format!(
					"/servers/{}/members/{}/roles/{}",
					enc(server_id),
					enc(user_id),
					enc(role_id)
				),
				&serde_json::json!({}),
			)
			.await
	}

	pub async fn role_unassign(&self, server_id: &str, user_id: &str, role_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!(
				"/servers/{}/members/{}/roles/{}",
				enc(server_id),
				enc(user_id),
				enc(role_id)
			))
			.await
	}

	pub async fn role_reorder(&self, server_id: &str, role_ids: &[String]) -> Result<Json> {
		self.transport
			.post(
				&format!("/servers/{}/roles/reorder", enc(server_id)),
				&serde_json::json!({ "roleIds": role_ids }),
			)
			.await
	}

	pub async fn my_permissions(&self, server_id: &str) -> Result<Json> {
		self.transport
			.get(&format!("/servers/{}/members/@me/permissions", enc(server_id)))
			.await
	}
}
