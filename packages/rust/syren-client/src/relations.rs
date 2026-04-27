use crate::client::Client;
use crate::error::Result;
use serde_json::{json, Value as Json};
use syren_types::{
	BlockedRow, Friendship, FriendshipRow, IgnoredRow, Page, RelationsSnapshot, SuccessResponse,
};

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn relations_snapshot(&self) -> Result<RelationsSnapshot> {
		self.transport.get("/users/@me/relations").await
	}

	pub async fn friend_send(
		&self,
		user_id: &str,
		syr_instance_url: Option<&str>,
	) -> Result<Friendship> {
		self.transport
			.post(
				"/users/@me/friends",
				&json!({
					"user_id": user_id,
					"syr_instance_url": syr_instance_url,
				}),
			)
			.await
	}

	pub async fn friend_accept(&self, user_id: &str) -> Result<Friendship> {
		self.transport
			.post(
				&format!("/users/@me/friends/{}/accept", enc(user_id)),
				&json!({}),
			)
			.await
	}

	pub async fn friend_decline(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.post(
				&format!("/users/@me/friends/{}/decline", enc(user_id)),
				&json!({}),
			)
			.await
	}

	pub async fn friend_remove(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/users/@me/friends/{}", enc(user_id)))
			.await
	}

	pub async fn block(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.post(
				"/users/@me/blocklist",
				&json!({ "user_id": user_id }),
			)
			.await
	}

	pub async fn unblock(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/users/@me/blocklist/{}", enc(user_id)))
			.await
	}

	pub async fn ignore(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.post(
				"/users/@me/ignorelist",
				&json!({ "user_id": user_id }),
			)
			.await
	}

	pub async fn unignore(&self, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/users/@me/ignorelist/{}", enc(user_id)))
			.await
	}

	pub async fn list_friends(&self, params: &Json) -> Result<Page<FriendshipRow>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			"/users/@me/friends".to_string()
		} else {
			format!("/users/@me/friends?{q}")
		};
		self.transport.get(&path).await
	}

	pub async fn list_blocked(&self, params: &Json) -> Result<Page<BlockedRow>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			"/users/@me/blocklist".to_string()
		} else {
			format!("/users/@me/blocklist?{q}")
		};
		self.transport.get(&path).await
	}

	pub async fn list_ignored(&self, params: &Json) -> Result<Page<IgnoredRow>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			"/users/@me/ignorelist".to_string()
		} else {
			format!("/users/@me/ignorelist?{q}")
		};
		self.transport.get(&path).await
	}
}
