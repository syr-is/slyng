//! # syren-types
//!
//! Shared data model for the Syren chat platform. This crate defines every
//! API entity (servers, channels, messages, members, roles, …) and every
//! WebSocket payload as plain Rust structs, with three derives that make
//! the same definition usable from three consumption surfaces:
//!
//! - **`#[derive(Serialize, Deserialize)]`** — `syren-client` uses these
//!   types directly to deserialise reqwest responses and serialise request
//!   bodies. The wire format is JSON, the field names match the API.
//! - **`#[derive(ZodSchema)]`** (from [`zod_gen`]) — a small `generate-zod`
//!   binary in this crate consumes every type and emits a Zod schema file
//!   that replaces hand-authored TS schemas in `@syren/types`.
//! - **`#[derive(Tsify)]`** (from [`tsify_next`], wasm-only) — auto-derives
//!   matching TypeScript interfaces in the wasm-pack `.d.ts` so JS callers
//!   of `@syren/client`'s WASM build get full type information without any
//!   hand-rolled bindings.
//!
//! The wire format treats SurrealDB record-ids and ISO timestamps as
//! **strings**; we don't model them as `RecordId` / `chrono::DateTime`
//! here so the crate stays dependency-free of those ecosystems.
//! Consumers that want richer types can wrap on their side.
//!
//! [`zod_gen`]: https://crates.io/crates/zod_gen
//! [`tsify_next`]: https://crates.io/crates/tsify-next

pub mod audit;
pub mod auth;
pub mod channel;
pub mod common;
pub mod invite;
pub mod member;
pub mod message;
pub mod pagination;
pub mod permission;
pub mod presence;
pub mod reaction;
pub mod relation;
pub mod server;
pub mod trash;
pub mod upload;
pub mod user;
pub mod voice;
pub mod ws;

pub use audit::*;
pub use auth::*;
pub use channel::*;
pub use common::*;
pub use invite::*;
pub use member::*;
pub use message::*;
pub use pagination::*;
pub use permission::*;
pub use presence::*;
pub use reaction::*;
pub use relation::*;
pub use server::*;
pub use trash::*;
pub use upload::*;
pub use user::*;
pub use voice::*;
pub use ws::*;
