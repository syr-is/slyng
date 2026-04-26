use crate::client::Client;
use crate::error::Result;
use crate::types::{ExchangeRequest, ExchangeResponse, Identity, LoginRequest, LoginResponse};

impl Client {
	/// POST /auth/login — start the OAuth flow with the given syr
	/// instance URL. The server returns a `consent_url`; the caller is
	/// responsible for navigating the user there (system browser on
	/// native, full-page redirect on web). `redirect` controls where
	/// the API will send the user after the OAuth round-trip — for
	/// native it should be `syren://auth/callback`.
	pub async fn login_start(
		&self,
		instance_url: impl Into<String>,
		redirect: Option<String>,
	) -> Result<LoginResponse> {
		let body = LoginRequest {
			instance_url: instance_url.into(),
			redirect,
		};
		self.transport.post("/auth/login", &body).await
	}

	/// POST /auth/exchange — swap a one-shot bridge code (delivered
	/// via deep link) for a long-lived session id. The session id is
	/// then stored in the `SessionStore` so subsequent calls carry it
	/// in the `Authorization: Bearer` header.
	pub async fn login_complete(&self, code: impl Into<String>) -> Result<Identity> {
		let code: String = code.into();
		eprintln!("[client/login_complete] start; code_len={}", code.len());
		let body = ExchangeRequest { code };
		let exchange: Result<ExchangeResponse> = self.transport.post("/auth/exchange", &body).await;
		let resp = match exchange {
			Ok(r) => {
				eprintln!(
					"[client/login_complete] /auth/exchange OK; session_len={}",
					r.session.len()
				);
				r
			}
			Err(e) => {
				eprintln!("[client/login_complete] /auth/exchange ERR = {e}");
				return Err(e);
			}
		};
		self.transport.store.set(&resp.session).await;
		let readback = self.transport.store.get().await;
		eprintln!(
			"[client/login_complete] store readback present={} matches={}",
			readback.is_some(),
			readback.as_deref() == Some(resp.session.as_str())
		);
		match self.me().await {
			Ok(id) => {
				eprintln!("[client/login_complete] /auth/me OK did={}", id.did);
				Ok(id)
			}
			Err(e) => {
				eprintln!("[client/login_complete] /auth/me ERR = {e}");
				Err(e)
			}
		}
	}

	/// GET /auth/me — current identity for the active session.
	pub async fn me(&self) -> Result<Identity> {
		self.transport.get("/auth/me").await
	}

	/// POST /auth/logout — invalidate the active session and clear
	/// the local store.
	pub async fn logout(&self) -> Result<()> {
		let _: serde_json::Value = self
			.transport
			.post("/auth/logout", &serde_json::json!({}))
			.await
			.unwrap_or(serde_json::Value::Null);
		self.transport.store.clear().await;
		Ok(())
	}
}
