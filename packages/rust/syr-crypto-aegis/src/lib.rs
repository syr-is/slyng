//! Aegis (CIGP) - Custodial Identity Protection.
//! Encrypts Ed25519 seed with user password using Argon2id + AES-256-GCM.
//! AAD: "cigp:v1"

mod aegis;

pub use aegis::{create_aegis_bundle, decrypt_aegis_bundle, AegisBundle, AegisKdfParams};
