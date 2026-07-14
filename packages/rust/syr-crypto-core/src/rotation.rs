//! Root key rotation statements.

use serde::{Deserialize, Serialize};

use crate::canonical::canonicalize;
use crate::encoding::{decode_multibase, encode_multibase, ED25519_MULTICODEC_PREFIX};
use crate::keys::{sign, verify};

/// A rotation statement signed by the current root key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationStatement {
    pub did: String,
    #[serde(rename = "newRoot")]
    pub new_root: String,
    #[serde(rename = "rotatedAt")]
    pub rotated_at: String,
    pub signature: String,
}

/// Create a root key rotation statement.
pub fn create_rotation_statement(
    did: &str,
    new_public_key: &[u8; 32],
    current_private_key: &[u8; 32],
) -> Result<RotationStatement, String> {
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(new_public_key);
    let new_root = encode_multibase(&prefixed);

    let rotated_at = chrono::Utc::now().to_rfc3339();

    #[derive(Serialize)]
    struct Payload<'a> {
        did: &'a str,
        #[serde(rename = "newRoot")]
        new_root: &'a str,
        #[serde(rename = "rotatedAt")]
        rotated_at: &'a str,
    }
    let payload_obj = Payload {
        did,
        new_root: &new_root,
        rotated_at: &rotated_at,
    };
    let payload_str = canonicalize(&payload_obj)?;
    let payload_bytes = payload_str.as_bytes();

    let signature_bytes = sign(payload_bytes, current_private_key)?;
    let signature = encode_multibase(&signature_bytes);

    Ok(RotationStatement {
        did: did.to_string(),
        new_root,
        rotated_at,
        signature,
    })
}

/// Verify a root key rotation statement.
pub fn verify_rotation_statement(
    statement: &RotationStatement,
    current_public_key: &[u8; 32],
) -> Result<bool, String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        did: &'a str,
        #[serde(rename = "newRoot")]
        new_root: &'a str,
        #[serde(rename = "rotatedAt")]
        rotated_at: &'a str,
    }
    let payload_obj = Payload {
        did: &statement.did,
        new_root: &statement.new_root,
        rotated_at: &statement.rotated_at,
    };
    let payload_str = canonicalize(&payload_obj)?;
    let payload_bytes = payload_str.as_bytes();

    let signature_bytes = decode_multibase(&statement.signature)?;
    if signature_bytes.len() != 64 {
        return Err("Invalid signature length".to_string());
    }
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&signature_bytes);

    Ok(verify(payload_bytes, &sig, current_public_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::generate_root_keypair;

    #[test]
    fn create_and_verify_rotation_statement() {
        let (old_pub, old_priv) = generate_root_keypair();
        let (new_pub, _) = generate_root_keypair();
        let did = crate::encoding::derive_did(&old_pub);

        let stmt = create_rotation_statement(&did, &new_pub, &old_priv).unwrap();
        assert_eq!(stmt.did, did);
        assert!(!stmt.signature.is_empty());

        let valid = verify_rotation_statement(&stmt, &old_pub).unwrap();
        assert!(valid);
    }

    #[test]
    fn verify_rotation_rejects_wrong_key() {
        let (old_pub, old_priv) = generate_root_keypair();
        let (new_pub, _) = generate_root_keypair();
        let (wrong_pub, _) = generate_root_keypair();
        let did = crate::encoding::derive_did(&old_pub);

        let stmt = create_rotation_statement(&did, &new_pub, &old_priv).unwrap();
        let valid = verify_rotation_statement(&stmt, &wrong_pub).unwrap();
        assert!(!valid);
    }
}
