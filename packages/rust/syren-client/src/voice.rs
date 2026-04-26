use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

impl Client {
	pub async fn voice_token(&self, channel_id: &str) -> Result<Json> {
		self.transport
			.post(
				"/voice/token",
				&serde_json::json!({ "channel_id": channel_id }),
			)
			.await
	}
}
