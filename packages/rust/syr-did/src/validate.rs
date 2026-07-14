//! Validate did:syr identifiers.

use crate::parse::parse_did;

/// Check if a string is a valid did:syr identifier.
pub fn is_valid_syr_did(did: &str) -> bool {
    parse_did(did).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use syr_crypto_core::encoding::derive_did;
    use syr_crypto_core::keys::generate_root_keypair;

    #[test]
    fn is_valid_syr_did_true_for_valid() {
        let (pub_k, _) = generate_root_keypair();
        let did = derive_did(&pub_k);
        assert!(is_valid_syr_did(&did));
    }

    #[test]
    fn is_valid_syr_did_false_for_invalid() {
        assert!(!is_valid_syr_did("did:web:example.com"));
        assert!(!is_valid_syr_did(""));
        assert!(!is_valid_syr_did("did:syr:abc123"));
    }
}
