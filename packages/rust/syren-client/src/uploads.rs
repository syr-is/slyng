use crate::client::Client;
use crate::error::Result;
use crate::types::Json;

fn enc(v: &str) -> String {
	super::servers::urlencode(v)
}

impl Client {
	pub async fn upload_presign(&self, body: &Json) -> Result<Json> {
		self.transport.post("/uploads/presign", body).await
	}

	pub async fn upload_finalize(&self, upload_id: &str, body: &Json) -> Result<Json> {
		self.transport
			.patch(&format!("/uploads/{}/finalize", enc(upload_id)), body)
			.await
	}
}
