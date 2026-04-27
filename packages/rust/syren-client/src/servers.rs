use crate::client::Client;
use crate::error::Result;
use serde_json::{json, Value as Json};
use syren_types::{
	AuditLog, Channel, MemberMessageEntry, MemberMessageStats, Page, PaginatedQuery, Server,
	ServerBan, ServerInvite, ServerMember, SuccessResponse, TransferOwnershipResponse,
	TrashChannelEntry, TrashMessageEntry, TrashRoleEntry, VoiceStatesByChannel,
};

fn enc(v: &str) -> String {
	urlencode(v)
}

// Percent-encoder for path segments. We *do* encode `:` and `@`
// despite both being legal in RFC 3986 path segments — the legacy
// `app-core/api.ts` used `encodeURIComponent` (which encodes `:` →
// `%3A` and `@` → `%40`), and the production NestJS deployment
// turned out to silently rely on that shape: requests with raw
// colons in the path were routing through to the membership guard
// with a `serverId` that wouldn't round-trip through
// `stringToRecordId.decode`, returning 403 "not a member" for valid
// members. Encoding here matches what the server already accepts
// and what every pre-migration build sent. The literal `@me`
// fragments in routes like `/servers/@me` and
// `/servers/{id}/members/@me/permissions` are baked into the
// `format!()` strings (they're not run through this function), so
// they stay unencoded as before.
pub(crate) fn urlencode(input: &str) -> String {
	let mut out = String::with_capacity(input.len());
	for b in input.bytes() {
		match b {
			b'/' | b'?' | b'#' | b'%' | b' ' | b':' | b'@' => {
				out.push('%');
				out.push_str(&format!("{b:02X}"));
			}
			_ => out.push(b as char),
		}
	}
	out
}

impl Client {
	pub async fn servers_list(&self) -> Result<Vec<Server>> {
		self.transport.get("/servers/@me").await
	}

	pub async fn server_get(&self, id: &str) -> Result<Server> {
		self.transport.get(&format!("/servers/{}", enc(id))).await
	}

	pub async fn server_create(&self, data: &Json) -> Result<Server> {
		self.transport.post("/servers", data).await
	}

	pub async fn server_update(&self, id: &str, data: &Json) -> Result<Server> {
		self.transport
			.patch(&format!("/servers/{}", enc(id)), data)
			.await
	}

	pub async fn server_delete(&self, id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/servers/{}", enc(id)))
			.await
	}

	pub async fn server_leave(&self, id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!("/servers/{}/members/@me", enc(id)))
			.await
	}

	pub async fn server_channels(&self, id: &str) -> Result<Vec<Channel>> {
		self.transport
			.get(&format!("/servers/{}/channels", enc(id)))
			.await
	}

	pub async fn server_members(&self, id: &str) -> Result<Vec<ServerMember>> {
		self.transport
			.get(&format!("/servers/{}/members", enc(id)))
			.await
	}

	pub async fn server_members_page(
		&self,
		id: &str,
		p: &PaginatedQuery,
	) -> Result<Page<ServerMember>> {
		let q = serde_urlencoded::to_string(p).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/members", enc(id))
		} else {
			format!("/servers/{}/members?{q}", enc(id))
		};
		self.transport.get(&path).await
	}

	pub async fn server_voice_states(&self, id: &str) -> Result<VoiceStatesByChannel> {
		self.transport
			.get(&format!("/servers/{}/voice-states", enc(id)))
			.await
	}

	pub async fn member_kick(
		&self,
		server_id: &str,
		user_id: &str,
		delete_seconds: Option<u32>,
	) -> Result<SuccessResponse> {
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

	pub async fn member_ban(&self, server_id: &str, body: &Json) -> Result<ServerBan> {
		self.transport
			.post(&format!("/servers/{}/bans", enc(server_id)), body)
			.await
	}

	pub async fn member_unban(&self, server_id: &str, user_id: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!(
				"/servers/{}/bans/{}",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn audit_log(&self, server_id: &str, params: &Json) -> Result<Page<AuditLog>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/audit-log", enc(server_id))
		} else {
			format!("/servers/{}/audit-log?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn invites_create(
		&self,
		server_id: &str,
		data: &Json,
	) -> Result<syren_types::CreateInviteResponse> {
		self.transport
			.post(&format!("/servers/{}/invites", enc(server_id)), data)
			.await
	}

	pub async fn invites_list(
		&self,
		server_id: &str,
		p: &PaginatedQuery,
	) -> Result<Page<ServerInvite>> {
		let q = serde_urlencoded::to_string(p).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/invites", enc(server_id))
		} else {
			format!("/servers/{}/invites?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn invite_delete(&self, server_id: &str, code: &str) -> Result<SuccessResponse> {
		self.transport
			.delete(&format!(
				"/servers/{}/invites/{}",
				enc(server_id),
				enc(code)
			))
			.await
	}

	pub async fn server_create_channel(&self, server_id: &str, data: &Json) -> Result<Channel> {
		self.transport
			.post(&format!("/servers/{}/channels", enc(server_id)), data)
			.await
	}

	pub async fn server_transfer_ownership(
		&self,
		server_id: &str,
		new_owner_id: &str,
	) -> Result<TransferOwnershipResponse> {
		self.transport
			.post(
				&format!("/servers/{}/transfer-ownership", enc(server_id)),
				&json!({ "new_owner_id": new_owner_id }),
			)
			.await
	}

	pub async fn list_bans(&self, server_id: &str, params: &Json) -> Result<Page<ServerBan>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/bans", enc(server_id))
		} else {
			format!("/servers/{}/bans?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}

	pub async fn member_messages(
		&self,
		server_id: &str,
		user_id: &str,
		params: &Json,
	) -> Result<Page<MemberMessageEntry>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!(
				"/servers/{}/members/{}/messages",
				enc(server_id),
				enc(user_id)
			)
		} else {
			format!(
				"/servers/{}/members/{}/messages?{q}",
				enc(server_id),
				enc(user_id)
			)
		};
		self.transport.get(&path).await
	}

	pub async fn member_message_stats(
		&self,
		server_id: &str,
		user_id: &str,
	) -> Result<MemberMessageStats> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/message-stats",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn purge_member_messages(
		&self,
		server_id: &str,
		user_id: &str,
		body: &Json,
	) -> Result<SuccessResponse> {
		self.transport
			.post(
				&format!(
					"/servers/{}/members/{}/purge",
					enc(server_id),
					enc(user_id)
				),
				body,
			)
			.await
	}

	pub async fn member_ban_history(
		&self,
		server_id: &str,
		user_id: &str,
	) -> Result<Vec<ServerBan>> {
		self.transport
			.get(&format!(
				"/servers/{}/members/{}/ban-history",
				enc(server_id),
				enc(user_id)
			))
			.await
	}

	pub async fn member_audit_log(
		&self,
		server_id: &str,
		user_id: &str,
		params: &Json,
	) -> Result<Page<AuditLog>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!(
				"/servers/{}/members/{}/audit-log",
				enc(server_id),
				enc(user_id)
			)
		} else {
			format!(
				"/servers/{}/members/{}/audit-log?{q}",
				enc(server_id),
				enc(user_id)
			)
		};
		self.transport.get(&path).await
	}

	pub async fn update_invite(
		&self,
		server_id: &str,
		code: &str,
		data: &Json,
	) -> Result<ServerInvite> {
		self.transport
			.patch(
				&format!("/servers/{}/invites/{}", enc(server_id), enc(code)),
				data,
			)
			.await
	}

	pub async fn trash_channels(&self, server_id: &str) -> Result<Vec<TrashChannelEntry>> {
		self.transport
			.get(&format!("/servers/{}/trash/channels", enc(server_id)))
			.await
	}

	pub async fn trash_roles(&self, server_id: &str) -> Result<Vec<TrashRoleEntry>> {
		self.transport
			.get(&format!("/servers/{}/trash/roles", enc(server_id)))
			.await
	}

	pub async fn trash_messages(
		&self,
		server_id: &str,
		params: &Json,
	) -> Result<Page<TrashMessageEntry>> {
		let q = serde_urlencoded::to_string(params).unwrap_or_default();
		let path = if q.is_empty() {
			format!("/servers/{}/trash/messages", enc(server_id))
		} else {
			format!("/servers/{}/trash/messages?{q}", enc(server_id))
		};
		self.transport.get(&path).await
	}
}
