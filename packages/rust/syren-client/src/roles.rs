use crate::client::Client;
use crate::error::Result;
use serde_json::{json, Value as Json};
use syren_types::{
	MemberPermissionsView, MyPermissions, PermissionTree, ServerRole, SuccessResponse,
};

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn roles_list(&self, server_id: &str) -> Result<Vec<ServerRole>> {
		self.transport
			.get(&format!("/servers/{}/roles", enc(server_id)))
			.await
	}

	pub async fn role_create(&self, server_id: &str, data: &Json) -> Result<ServerRole> {
		self.transport
			.post(&format!("/servers/{}/roles", enc(server_id)), data)
			.await
	}

	pub async fn role_update(&self, role_id: &str, data: &Json) -> Result<ServerRole> {
		self.transport
			.patch(&format!("/roles/{}", enc(role_id)), data)
			.await
	}

	pub async fn role_delete(&self, role_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/roles/{}", enc(role_id)))
			.await
	}

	pub async fn role_assign(
		&self,
		server_id: &str,
		user_id: &str,
		role_id: &str,
	) -> Result<SuccessResponse> {
		self.transport
			.post(
				&format!(
					"/servers/{}/members/{}/roles/{}",
					enc(server_id),
					enc(user_id),
					enc(role_id)
				),
				&json!({}),
			)
			.await
	}

	pub async fn role_unassign(
		&self,
		server_id: &str,
		user_id: &str,
		role_id: &str,
	) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!(
				"/servers/{}/members/{}/roles/{}",
				enc(server_id),
				enc(user_id),
				enc(role_id)
			))
			.await
	}

	pub async fn role_reorder(
		&self,
		server_id: &str,
		role_ids: &[String],
	) -> Result<SuccessResponse> {
		self.transport
			.post(
				&format!("/servers/{}/roles/reorder", enc(server_id)),
				&json!({ "roleIds": role_ids }),
			)
			.await
	}

	pub async fn my_permissions(&self, server_id: &str) -> Result<MyPermissions> {
		self.transport
			.get(&format!(
				"/servers/{}/members/@me/permissions",
				enc(server_id)
			))
			.await
	}

	pub async fn role_swap(
		&self,
		role_id: &str,
		other_role_id: &str,
	) -> Result<SuccessResponse> {
		self.transport
			.post(
				&format!("/roles/{}/swap/{}", enc(role_id), enc(other_role_id)),
				&json!({}),
			)
			.await
	}

	pub async fn role_permission_tree(
		&self,
		server_id: &str,
		user_id: &str,
	) -> Result<PermissionTree> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/permission-tree",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn role_member_permissions(
		&self,
		server_id: &str,
		user_id: &str,
	) -> Result<MemberPermissionsView> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/permissions",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn role_restore(&self, role_id: &str) -> Result<ServerRole> {
		self.transport
			.post(&format!("/roles/{}/restore", enc(role_id)), &json!({}))
			.await
	}

	pub async fn role_hard_delete(&self, role_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/roles/{}/hard", enc(role_id)))
			.await
	}
}
