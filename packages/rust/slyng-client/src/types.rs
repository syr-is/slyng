//! Compatibility re-exports.
//!
//! Auth + pagination types previously lived here; after Phase 1 of the
//! typed-client refactor they live in `slyng-types`, which is the
//! source of truth. This module just re-exports the common ones so
//! existing internal call sites and downstream Rust crates can keep
//! `use slyng_client::{LoginResponse, Identity, …}` until they migrate
//! to `use slyng_types::*` directly.

pub use slyng_types::{
	ExchangeRequest, ExchangeResponse, Identity, LoginRequest, LoginResponse,
	Page, PaginatedQuery,
};

/// Loose-shape JSON for the few escape-hatch endpoints that haven't yet
/// been retyped (only `Client::request_raw` after Phase 2; will be
/// removed in Phase 8).
pub type Json = serde_json::Value;

/// Backwards-compatible alias for the old name. Drop in Phase 8 once
/// every consumer has migrated to `PaginatedQuery`.
pub type Paginated = PaginatedQuery;
