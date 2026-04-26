use crate::error::{Error, Result};
use crate::session::SessionStore;
use reqwest::{Client as ReqwestClient, Method, RequestBuilder, Response};
use serde::{de::DeserializeOwned, Serialize};
use std::sync::Arc;
use url::Url;

/// HTTP transport — wraps `reqwest::Client`, attaches the bearer token
/// from the configured `SessionStore` to every outgoing request,
/// surfaces non-2xx responses as `Error::Status` with the body as the
/// message.
pub struct Transport {
	pub(crate) http: ReqwestClient,
	pub(crate) base: Url,
	pub(crate) store: Arc<dyn SessionStore>,
}

impl Transport {
	pub fn new(base: Url, store: Arc<dyn SessionStore>) -> Result<Self> {
		// Native + WASM both honor `cookies` cargo feature when enabled.
		// On WASM that feature is ignored (web-sys::Fetch handles cookies
		// according to credentials mode).
		let http = ReqwestClient::builder()
			.user_agent("syren-client/0.0.1")
			.build()?;

		Ok(Self { http, base, store })
	}

	/// Build a URL relative to the base, e.g. `path("/auth/me")` →
	/// `https://app.example.com/api/auth/me`.
	fn url(&self, path: &str) -> Result<Url> {
		// `path` is expected to start with '/' and be the API path
		// AFTER the `/api` prefix (e.g. "/auth/me").
		let full = format!("/api{path}");
		Ok(self.base.join(&full)?)
	}

	async fn send_with_auth(&self, mut req: RequestBuilder) -> Result<Response> {
		let session = self.store.get().await;
		eprintln!("[transport] bearer present = {}", session.is_some());
		if let Some(session) = session {
			req = req.header("Authorization", format!("Bearer {session}"));
		}
		// `credentials: include`-equivalent via reqwest cookies feature
		// (native) and via web-sys default (WASM).
		let resp = req.send().await?;
		eprintln!("[transport] response status = {}", resp.status());
		Ok(resp)
	}

	async fn handle<T: DeserializeOwned>(&self, resp: Response) -> Result<T> {
		let status = resp.status();
		let bytes = resp.bytes().await?;
		if !status.is_success() {
			let message = serde_json::from_slice::<serde_json::Value>(&bytes)
				.ok()
				.and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
				.unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned());
			return Err(Error::Status {
				status: status.as_u16(),
				message,
			});
		}
		// Tolerate empty body for `T = ()` shaped calls by returning
		// null which serde_json maps to ().
		if bytes.is_empty() {
			let null = serde_json::Value::Null;
			return Ok(serde_json::from_value(null)?);
		}
		Ok(serde_json::from_slice(&bytes)?)
	}

	pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
		let url = self.url(path)?;
		let resp = self.send_with_auth(self.http.request(Method::GET, url)).await?;
		self.handle(resp).await
	}

	pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
		let url = self.url(path)?;
		let resp = self.send_with_auth(self.http.request(Method::DELETE, url)).await?;
		self.handle(resp).await
	}

	pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T> {
		let url = self.url(path)?;
		let req = self.http.request(Method::POST, url).json(body);
		let resp = self.send_with_auth(req).await?;
		self.handle(resp).await
	}

	pub async fn patch<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T> {
		let url = self.url(path)?;
		let req = self.http.request(Method::PATCH, url).json(body);
		let resp = self.send_with_auth(req).await?;
		self.handle(resp).await
	}

	pub async fn put<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T> {
		let url = self.url(path)?;
		let req = self.http.request(Method::PUT, url).json(body);
		let resp = self.send_with_auth(req).await?;
		self.handle(resp).await
	}
}
