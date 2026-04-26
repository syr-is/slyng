//! `syren-client` — unified Rust + WASM client for the syren API.
//!
//! Same source compiles two ways:
//!   - native (`rlib`): consumed by the Tauri app via `Cargo.toml`
//!     path dependency. HTTP via reqwest with rustls + persistent
//!     cookie support; WS via tokio-tungstenite.
//!   - WASM (`cdylib`): consumed by the SvelteKit web app through
//!     `wasm-bindgen` + `wasm-pack`. HTTP via web-sys::Fetch; WS via
//!     gloo-net::websocket.
//!
//! See `packages/ts/client` for the TypeScript adapter that wraps
//! the WASM build with a typed surface.

pub mod client;
pub mod error;
pub mod session;
pub mod transport;
pub mod types;
pub mod ws;

mod auth;
mod categories;
mod channels;
mod invites;
mod overrides;
mod relations;
mod roles;
mod servers;
mod uploads;
mod users;
mod voice;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use client::Client;
pub use error::{Error, Result};
pub use session::{MemoryStore, SessionStore};
#[cfg(target_arch = "wasm32")]
pub use session::LocalStorageStore;
pub use types::*;
