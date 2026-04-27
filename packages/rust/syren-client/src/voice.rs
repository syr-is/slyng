use crate::client::Client;
use crate::error::Result;
use serde_json::json;
use syren_types::VoiceTokenResponse;

impl Client {
	pub async fn voice_token(&self, channel_id: &str) -> Result<VoiceTokenResponse> {
		self.transport
			.post("/voice/token", &json!({ "channel_id": channel_id }))
			.await
	}
}
