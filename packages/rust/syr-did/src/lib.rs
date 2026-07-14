//! did:syr parse, document, validate.

pub mod document;
pub mod parse;
pub mod types;
pub mod validate;

pub use document::{build_did_document, BuildDidDocumentInput};
pub use parse::parse_did;
pub use types::{DidDocument, ParsedDid, ServiceEndpoint, VerificationMethod};
pub use validate::is_valid_syr_did;
