use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn invite_preview(&self, code: &str) -> Result<Json> {
		self.transport.get(&format!("/invites/{}", enc(code))).await
	}

	pub async fn invite_join(&self, code: &str) -> Result<Json> {
		self.transport
			.post(&format!("/invites/{}", enc(code)), &serde_json::json!({}))
			.await
	}
}
