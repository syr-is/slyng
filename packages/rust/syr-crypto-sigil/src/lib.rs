//! Sigil (PIEF) - Portable Identity Export Format.
//! Encrypts Ed25519 seed with export passphrase using Argon2id + AES-256-GCM.
//! AAD: "pief:v1"

mod sigil;

pub use sigil::{create_sigil, decrypt_sigil, SigilEnc, SigilKdf, SigilObject};
