//! Multibase encoding/decoding and DID derivation.

use bs58;

/// Multicodec prefix for Ed25519 public keys. varint 0xed = [0xed, 0x01]
pub const ED25519_MULTICODEC_PREFIX: [u8; 2] = [0xed, 0x01];

/// Multicodec prefix for Ed25519 private keys. varint 0x1300 = [0x80, 0x26]
pub const ED25519_PRIV_MULTICODEC_PREFIX: [u8; 2] = [0x80, 0x26];

/// Encode bytes as multibase base58btc string (prefix 'z').
pub fn encode_multibase(bytes: &[u8]) -> String {
    format!("z{}", bs58::encode(bytes).into_string())
}

/// Decode multibase base58btc string to bytes.
pub fn decode_multibase(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.is_empty() {
        return Err("Empty input: missing multibase prefix.".to_string());
    }
    if !encoded.starts_with('z') {
        return Err(format!(
            "Unsupported multibase prefix: '{}'. Expected 'z' (base58btc).",
            encoded.chars().next().unwrap_or(' ')
        ));
    }
    bs58::decode(&encoded[1..])
        .into_vec()
        .map_err(|e| e.to_string())
}

/// Decode multibase-encoded Ed25519 public key to 32 raw bytes.
pub fn decode_public_key(encoded: &str) -> Result<[u8; 32], String> {
    let bytes = decode_multibase(encoded)?;
    let raw: Vec<u8> = if bytes.len() == 34
        && bytes[0] == ED25519_MULTICODEC_PREFIX[0]
        && bytes[1] == ED25519_MULTICODEC_PREFIX[1]
    {
        bytes[2..].to_vec()
    } else {
        bytes
    };
    if raw.len() != 32 {
        return Err(format!(
            "Invalid public key length: expected 32 bytes (Ed25519), got {} after decoding.",
            raw.len()
        ));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&raw);
    Ok(arr)
}

/// Decode multibase-encoded Ed25519 private key to 32 raw bytes.
pub fn decode_private_key(encoded: &str) -> Result<[u8; 32], String> {
    let bytes = decode_multibase(encoded)?;
    let raw: Vec<u8> = if bytes.len() == 34
        && bytes[0] == ED25519_PRIV_MULTICODEC_PREFIX[0]
        && bytes[1] == ED25519_PRIV_MULTICODEC_PREFIX[1]
    {
        bytes[2..].to_vec()
    } else {
        bytes
    };
    if raw.len() != 32 {
        return Err(format!(
            "Invalid private key length: expected 32 bytes (Ed25519), got {} after decoding.",
            raw.len()
        ));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&raw);
    Ok(arr)
}

/// Encode 32-byte Ed25519 private key seed as multibase with multicodec prefix.
pub fn encode_private_key(raw: &[u8; 32]) -> String {
    let mut prefixed = Vec::with_capacity(ED25519_PRIV_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_PRIV_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(raw);
    encode_multibase(&prefixed)
}

/// Derive did:syr identifier from Ed25519 public key.
pub fn derive_did(public_key: &[u8; 32]) -> String {
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(public_key);
    format!("did:syr:{}", encode_multibase(&prefixed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_multibase_roundtrip() {
        let bytes: Vec<u8> = (0..32).collect();
        let encoded = encode_multibase(&bytes);
        assert!(encoded.starts_with('z'));
        let decoded = decode_multibase(&encoded).unwrap();
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn decode_multibase_rejects_empty() {
        assert!(decode_multibase("").is_err());
    }

    #[test]
    fn decode_multibase_rejects_wrong_prefix() {
        assert!(decode_multibase("mbase58").is_err());
    }

    #[test]
    fn derive_did_format() {
        let pk: [u8; 32] = [1; 32];
        let did = derive_did(&pk);
        assert!(did.starts_with("did:syr:z"));
    }

    #[test]
    fn encode_decode_private_key_roundtrip() {
        let (_, priv_k) = crate::keys::generate_root_keypair();
        let encoded = encode_private_key(&priv_k);
        assert!(encoded.starts_with('z'));
        let decoded = decode_private_key(&encoded).unwrap();
        assert_eq!(decoded, priv_k);
    }

    #[test]
    fn derive_did_decode_roundtrip() {
        let (pub_k, _) = crate::keys::generate_root_keypair();
        let did = derive_did(&pub_k);
        let id_part = did.strip_prefix("did:syr:").unwrap();
        let decoded = decode_public_key(id_part).unwrap();
        assert_eq!(decoded, pub_k);
    }
}
