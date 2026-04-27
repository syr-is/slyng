use crate::client::Client;
use crate::error::Result;
use crate::types::{Json, Page, Paginated};
use serde_json::json;

fn enc(v: &str) -> String {
	urlencode(v)
}

// Tiny percent-encoder for path segments. We only need to encode '/',
// '?', '#', '%', and a few others. The full RFC 3986 encoder lives in
// `url::form_urlencoded` for query strings; for path segments we want
// to preserve characters like ':' and '@' that the server uses (RecordIDs).
pub(crate) fn urlencode(input: &str) -> String {
	let mut out = String::with_capacity(input.len());
	for b in input.bytes() {
		match b {
			b'/' | b'?' | b'#' | b'%' | b' ' => {
				out.push('%');
				out.push_str(&format!("{b:02X}"));
			}
			_ => out.push(b as char),
		}
	}
	out
}

impl Client {
	pub async fn servers_list(&self) -> Result<Vec<Json>> {
		self.transport.get("/servers/@me").await
	}

	pub async fn server_get(&self, id: &str) -> Result<Json> {
		self.transport.get(&format!("/servers/{}", enc(id))).await
	}

	pub async fn server_create(&self, data: &Json) -> Result<Json> {
		self.transport.post("/servers", data).await
	}

	pub async fn server_update(&self, id: &str, data: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/servers/{}", enc(id)), data)
			.await
	}

	pub async fn server_delete(&self, id: &str) -> Result<Json> {
		self.transport
			.delete(&format!("/servers/{}", enc(id)))
			.await
	}

	pub async fn server_leave(&self, id: &str) -> Result<Json> {
		self.transport
			.delete(&format!("/servers/{}/members/@me", enc(id)))
			.await
	}

	pub async fn server_channels(&self, id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/channels", enc(id)))
			.await
	}

	pub async fn server_members(&self, id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/members", enc(id)))
			.await
	}

	pub async fn server_members_page(&self, id: &str, p: &Paginated) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(p).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/members", enc(id))
		} else {
			format!("/servers/{}/members?{q}", enc(id))
		};
		self.transport.get(&path).await
	}

	pub async fn server_voice_states(&self, id: &str) -> Result<Json> {
		self.transport
			.get(&format!("/servers/{}/voice-states", enc(id)))
			.await
	}

	pub async fn member_kick(
		&self,
		server_id: &str,
		user_id: &str,
		delete_seconds: Option<u32>,
	) -> Result<Json> {
		// `delete_seconds` is the optional rolling-window message purge
		// the server applies on kick (see member.controller.ts). It rides
		// as a query string because the underlying HTTP verb is DELETE
		// and the body is empty.
		let base = format!(
			"/servers/{}/members/{}",
			enc(server_id),
			enc(user_id)
		);
		let path = match delete_seconds {
			Some(s) => format!("{base}?delete_seconds={s}"),
			None => base,
		};
		self.transport.delete(&path).await
	}

	pub async fn member_ban(&self, server_id: &str, body: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/servers/{}/bans", enc(server_id)), body)
			.await
	}

	pub async fn member_unban(&self, server_id: &str, user_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!(
				"/servers/{}/bans/{}",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn audit_log(&self, server_id: &str, params: &Json) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/audit-log", enc(server_id))
		} else {
			format!("/servers/{}/audit-log?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn invites_create(&self, server_id: &str, data: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/servers/{}/invites", enc(server_id)), data)
			.await
	}

	pub async fn invites_list(&self, server_id: &str, p: &Paginated) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(p).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/invites", enc(server_id))
		} else {
			format!("/servers/{}/invites?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn invite_delete(&self, server_id: &str, code: &str) -> Result<Json> {
		self.transport
			.delete(&format!("/servers/{}/invites/{}", enc(server_id), enc(code)))
			.await
	}

	pub async fn server_create_channel(&self, server_id: &str, data: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/servers/{}/channels", enc(server_id)), data)
			.await
	}

	pub async fn server_transfer_ownership(&self, server_id: &str, new_owner_id: &str) -> Result<Json> {
		self.transport
			.post(
				&format!("/servers/{}/transfer-ownership", enc(server_id)),
				&json!({ "new_owner_id": new_owner_id }),
			)
			.await
	}

	pub async fn list_bans(&self, server_id: &str, params: &Json) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/bans", enc(server_id))
		} else {
			format!("/servers/{}/bans?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn member_messages(&self, server_id: &str, user_id: &str, params: &Json) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/members/{}/messages", enc(server_id), enc(user_id))
		} else {
			format!("/servers/{}/members/{}/messages?{q}", enc(server_id), enc(user_id))
		};
		self.transport.get(&path).await
	}

	pub async fn member_message_stats(&self, server_id: &str, user_id: &str) -> Result<Json> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/message-stats",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn purge_member_messages(&self, server_id: &str, user_id: &str, body: &Json) -> Result<Json> {
		self.transport
			.post(
				&format!("/servers/{}/members/{}/purge", enc(server_id), enc(user_id)),
				body,
			)
			.await
	}

	pub async fn member_ban_history(&self, server_id: &str, user_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/ban-history",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn member_audit_log(&self, server_id: &str, user_id: &str, params: &Json) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/members/{}/audit-log", enc(server_id), enc(user_id))
		} else {
			format!("/servers/{}/members/{}/audit-log?{q}", enc(server_id), enc(user_id))
		};
		self.transport.get(&path).await
	}

	pub async fn update_invite(&self, server_id: &str, code: &str, data: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/servers/{}/invites/{}", enc(server_id), enc(code)), data)
			.await
	}

	pub async fn trash_channels(&self, server_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/trash/channels", enc(server_id)))
			.await
	}

	pub async fn trash_roles(&self, server_id: &str) -> Result<Vec<Json>> {
		self.transport
			.get(&format!("/servers/{}/trash/roles", enc(server_id)))
			.await
	}

	pub async fn trash_messages(&self, server_id: &str, params: &Json) -> Result<Page<Json>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/trash/messages", enc(server_id))
		} else {
			format!("/servers/{}/trash/messages?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}
}
