//! Ed25519 key generation, signing, and verification.

use ed25519_dalek::ed25519::signature::{Signer, Verifier};
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use rand::rngs::OsRng;

/// Constant-time comparison of two byte arrays.
/// Use for comparing keys or tokens to avoid timing side channels.
pub fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Generate an Ed25519 root keypair.
pub fn generate_root_keypair() -> ([u8; 32], [u8; 32]) {
    generate_keypair()
}

/// Generate an Ed25519 device keypair.
pub fn generate_device_keypair() -> ([u8; 32], [u8; 32]) {
    generate_keypair()
}

fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key = signing_key.verifying_key();
    (
        public_key.as_bytes().to_owned(),
        signing_key.as_bytes().to_owned(),
    )
}

/// Derive the public key from a 32-byte seed (Ed25519 private key).
/// Used when recovering from Sigil: decrypt yields the seed, this gives the public key for DID.
pub fn derive_public_key_from_seed(seed: &[u8; 32]) -> [u8; 32] {
    let signing_key = SigningKey::from_bytes(seed);
    signing_key.verifying_key().to_bytes()
}

/// Sign a payload with an Ed25519 private key.
pub fn sign(payload: &[u8], private_key: &[u8; 32]) -> Result<[u8; 64], String> {
    let signing_key = SigningKey::from_bytes(private_key);
    let sig: Signature = signing_key.sign(payload);
    let mut arr = [0u8; 64];
    arr.copy_from_slice(sig.to_bytes().as_ref());
    Ok(arr)
}

/// Verify an Ed25519 signature.
pub fn verify(payload: &[u8], signature: &[u8], public_key: &[u8; 32]) -> bool {
    let key = match VerifyingKey::from_bytes(public_key) {
        Ok(k) => k,
        Err(_) => return false,
    };
    if signature.len() != 64 {
        return false;
    }
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);
    let sig = Signature::from_bytes(&sig_bytes);
    key.verify(payload, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_root_keypair_returns_32_byte_keys() {
        let (pub_k, priv_k) = generate_root_keypair();
        assert_eq!(pub_k.len(), 32);
        assert_eq!(priv_k.len(), 32);
    }

    #[test]
    fn generate_device_keypair_returns_32_byte_keys() {
        let (pub_k, priv_k) = generate_device_keypair();
        assert_eq!(pub_k.len(), 32);
        assert_eq!(priv_k.len(), 32);
    }

    #[test]
    fn generate_keypairs_are_unique() {
        let (pub_a, priv_a) = generate_root_keypair();
        let (pub_b, priv_b) = generate_root_keypair();
        assert_ne!(pub_a, pub_b);
        assert_ne!(priv_a, priv_b);
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let (pub_k, priv_k) = generate_root_keypair();
        let payload = b"hello world";
        let sig = sign(payload, &priv_k).unwrap();
        assert_eq!(sig.len(), 64);
        assert!(verify(payload, &sig, &pub_k));
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let (pub_k, priv_k) = generate_root_keypair();
        let sig = sign(b"original", &priv_k).unwrap();
        assert!(!verify(b"tampered", &sig, &pub_k));
    }

    #[test]
    fn constant_time_equal_same() {
        let a = [1u8; 32];
        assert!(constant_time_equal(&a, &a));
    }

    #[test]
    fn constant_time_equal_different() {
        let a = [1u8; 32];
        let mut b = [1u8; 32];
        b[0] = 2;
        assert!(!constant_time_equal(&a, &b));
    }

    #[test]
    fn constant_time_equal_different_length() {
        assert!(!constant_time_equal(&[1u8; 32], &[1u8; 16]));
    }
}
