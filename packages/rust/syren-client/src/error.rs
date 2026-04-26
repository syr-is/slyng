use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
	#[error("HTTP transport error: {0}")]
	Http(#[from] reqwest::Error),

	#[error("API returned status {status}: {message}")]
	Status { status: u16, message: String },

	#[error("invalid URL: {0}")]
	Url(#[from] url::ParseError),

	#[error("decode error: {0}")]
	Decode(#[from] serde_json::Error),

	#[error("auth error: {0}")]
	Auth(String),

	#[error("websocket error: {0}")]
	Ws(String),

	#[error("network error: {0}")]
	Network(String),

	#[error("not authenticated")]
	Unauthenticated,
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(target_arch = "wasm32")]
impl From<Error> for wasm_bindgen::JsValue {
	fn from(err: Error) -> wasm_bindgen::JsValue {
		wasm_bindgen::JsValue::from_str(&err.to_string())
	}
}
