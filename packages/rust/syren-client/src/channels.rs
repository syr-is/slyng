use crate::client::Client;
use crate::error::Result;
use crate::types::Json;
use serde_json::json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn channel_messages(&self, id: &str, before: Option<&str>, limit: Option<u32>) -> Result<Vec<Json>> {
		let mut path = format!("/channels/{}/messages", enc(id));
		let mut params = vec![];
		if let Some(b) = before {
			params.push(format!("before={}", enc(b)));
		}
		if let Some(l) = limit {
			params.push(format!("limit={l}"));
		}
		if !params.is_empty() {
			path.push('?');
			path.push_str(&params.join("&"));
		}
		self.transport.get(&path).await
	}

	pub async fn channel_send(&self, id: &str, body: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/channels/{}/messages", enc(id)), body)
			.await
	}

	pub async fn channel_edit_message(&self, channel_id: &str, message_id: &str, content: &str) -> Result<Json> {
		self.transport
			.patch(
				&format!("/channels/{}/messages/{}", enc(channel_id), enc(message_id)),
				&json!({ "content": content }),
			)
			.await
	}

	pub async fn channel_delete_message(&self, channel_id: &str, message_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!(
				"/channels/{}/messages/{}",
				enc(channel_id),
				enc(message_id)
			))
			.await
	}

	pub async fn channel_pins(&self, id: &str) -> Result<Vec<Json>> {
		self.transport.get(&format!("/channels/{}/pins", enc(id))).await
	}

	pub async fn channel_pin(&self, channel_id: &str, message_id: &str) -> Result<Json> {
		self.transport
			.post(
				&format!("/channels/{}/pins", enc(channel_id)),
				&json!({ "message_id": message_id }),
			)
			.await
	}

	pub async fn channel_unpin(&self, channel_id: &str, message_id: &str) -> Result<Json> {
		self.transport
			.delete(&format!(
				"/channels/{}/pins/{}",
				enc(channel_id),
				enc(message_id)
			))
			.await
	}

	pub async fn channel_typing(&self, id: &str) -> Result<Json> {
		self.transport
			.post(&format!("/channels/{}/typing", enc(id)), &json!({}))
			.await
	}

	pub async fn channel_update(&self, id: &str, data: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/channels/{}", enc(id)), data)
			.await
	}

	pub async fn channel_delete(&self, id: &str) -> Result<Json> {
		self.transport.delete(&format!("/channels/{}", enc(id))).await
	}

	pub async fn channel_reorder(&self, server_id: &str, body: &Json) -> Result<Json> {
		self.transport
			.post(&format!("/servers/{}/channels/reorder", enc(server_id)), body)
			.await
	}

	pub async fn channel_add_reaction(
		&self,
		channel_id: &str,
		message_id: &str,
		kind: &str,
		value: &str,
	) -> Result<Json> {
		self.transport
			.post(
				&format!(
					"/channels/{}/messages/{}/reactions",
					enc(channel_id),
					enc(message_id)
				),
				&json!({ "kind": kind, "value": value }),
			)
			.await
	}
}
