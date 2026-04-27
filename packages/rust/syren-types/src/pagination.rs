//! Pagination input/output shapes used by every list-shaped endpoint.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

/// Query string parameters supported by `BaseRepository.findPage` on the
/// API side. Every list endpoint accepts these in some combination.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PaginatedQuery {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub limit: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub offset: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub sort: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub order: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub q: Option<String>,
}

/// `{ items, total }` shape returned by `BaseRepository.findPage`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Page<T> {
	pub items: Vec<T>,
	pub total: u64,
}

// `Page<T>` is intentionally NOT decorated with `ZodSchema` / `Tsify`
// because `zod_gen` can't auto-generate over generics; downstream code
// that needs a Zod schema for `Page<Server>` etc. uses
// `ZodGenerator::add_schema::<PageOf<Server>>("PageServer")` via
// concrete monomorphisations declared in `bin/generate-zod.rs`.
impl<T> Page<T>
where
	T: DeserializeOwned,
{
	/// Convenience for tests.
	pub fn empty() -> Self {
		Self {
			items: Vec::new(),
			total: 0,
		}
	}
}

// ── Concrete page wrappers (so zod_gen / tsify can describe them). ──
//
// Each list endpoint that returns `Page<X>` gets a wrapper type here so
// the generated schemas have a stable name and the WASM binding can
// declare a non-generic return type. `syren-client` returns these
// wrappers directly.

macro_rules! page_of {
	($name:ident, $inner:ty) => {
		#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
		#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
		#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
		pub struct $name {
			pub items: Vec<$inner>,
			pub total: u64,
		}

		impl From<Page<$inner>> for $name {
			fn from(p: Page<$inner>) -> Self {
				Self {
					items: p.items,
					total: p.total,
				}
			}
		}

		impl From<$name> for Page<$inner> {
			fn from(p: $name) -> Self {
				Self {
					items: p.items,
					total: p.total,
				}
			}
		}
	};
}

page_of!(PageServerMember, crate::server::ServerMember);
page_of!(PageServerBan, crate::server::ServerBan);
page_of!(PageServerInvite, crate::server::ServerInvite);
page_of!(PageAuditLog, crate::audit::AuditLog);
page_of!(PageMemberMessageEntry, crate::member::MemberMessageEntry);
page_of!(PageTrashMessageEntry, crate::trash::TrashMessageEntry);
page_of!(PageFriendshipRow, crate::relation::FriendshipRow);
page_of!(PageBlockedRow, crate::relation::BlockedRow);
page_of!(PageIgnoredRow, crate::relation::IgnoredRow);
