use crate::client::Client;
use crate::error::Result;
use serde_json::json;
use syren_types::{InviteJoinResponse, InvitePreview};

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn invite_preview(&self, code: &str) -> Result<InvitePreview> {
		self.transport
			.get(&format!("/invites/{}", enc(code)))
			.await
	}

	pub async fn invite_join(&self, code: &str) -> Result<InviteJoinResponse> {
		self.transport
			.post(&format!("/invites/{}", enc(code)), &json!({}))
			.await
	}
}
