//! Parse did:syr identifiers.

use syr_crypto_core::encoding::{decode_multibase, ED25519_MULTICODEC_PREFIX};

use crate::types::ParsedDid;

static DID_SYR_REGEX: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"^did:syr:z[1-9A-HJ-NP-Za-km-z]+$").unwrap());

/// Parse a did:syr identifier into its components.
pub fn parse_did(did: &str) -> Result<ParsedDid, String> {
    if !DID_SYR_REGEX.is_match(did) {
        return Err(format!("Invalid did:syr format: '{}'", did));
    }

    let parts: Vec<&str> = did.split(':').collect();
    if parts.len() != 3 || parts[0] != "did" || parts[1] != "syr" {
        return Err(format!("Invalid did:syr format: '{}'", did));
    }

    let id = parts[2];

    let prefixed_bytes = decode_multibase(id)?;

    if prefixed_bytes.len() < ED25519_MULTICODEC_PREFIX.len() {
        return Err("Multibase-decoded bytes too short to contain multicodec prefix.".to_string());
    }

    for (i, &b) in ED25519_MULTICODEC_PREFIX.iter().enumerate() {
        if prefixed_bytes[i] != b {
            let hex = format!(
                "{:02x}{:02x}",
                prefixed_bytes[0],
                prefixed_bytes.get(1).copied().unwrap_or(0)
            );
            return Err(format!(
                "Expected Ed25519 multicodec prefix (0xed01), got 0x{}.",
                hex
            ));
        }
    }

    let public_key_slice = &prefixed_bytes[ED25519_MULTICODEC_PREFIX.len()..];
    if public_key_slice.len() != 32 {
        return Err(format!(
            "Expected 32-byte Ed25519 public key, got {} bytes.",
            public_key_slice.len()
        ));
    }

    let mut public_key = [0u8; 32];
    public_key.copy_from_slice(public_key_slice);

    Ok(ParsedDid {
        method: "syr".to_string(),
        id: id.to_string(),
        public_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use syr_crypto_core::encoding::derive_did;
    use syr_crypto_core::keys::generate_root_keypair;

    #[test]
    fn parse_valid_did() {
        let (pub_k, _) = generate_root_keypair();
        let did = derive_did(&pub_k);
        let parsed = parse_did(&did).unwrap();
        assert_eq!(parsed.method, "syr");
        assert_eq!(parsed.public_key, pub_k);
    }

    #[test]
    fn parse_rejects_did_web() {
        assert!(parse_did("did:web:example.com").is_err());
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(parse_did("").is_err());
    }

    #[test]
    fn parse_rejects_invalid_format() {
        assert!(parse_did("did:syr:abc123").is_err());
    }
}
