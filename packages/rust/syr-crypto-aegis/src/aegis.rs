//! Aegis bundle creation and decryption.

use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm};
use argon2::Argon2;
use base64::Engine;
use ed25519_dalek::SigningKey;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use syr_crypto_core::encoding::{encode_multibase, ED25519_MULTICODEC_PREFIX};

const AAD: &[u8] = b"cigp:v1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KDF_MEM_KIB: u32 = 65536;
const KDF_IT: u32 = 3;
const KDF_PAR: u32 = 1;
const KEY_LEN: usize = 32;

fn base64url_no_pad() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AegisKdfParams {
    pub mem: u32,
    pub it: u32,
    pub par: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AegisBundle {
    #[serde(rename = "pub")]
    pub pub_key: String,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
    pub tag: String,
    pub kdf: AegisKdfParams,
}

fn derive_key(
    password: &str,
    salt: &[u8],
    params: &AegisKdfParams,
) -> Result<[u8; KEY_LEN], String> {
    let pw: String = password.nfkc().collect();
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(params.mem, params.it, params.par, None).map_err(|e| e.to_string())?,
    );
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(pw.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// Create an Aegis bundle from a 32-byte seed and password.
pub fn create_aegis_bundle(seed: &[u8; 32], password: &str) -> Result<AegisBundle, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    let kdf = AegisKdfParams {
        mem: KDF_MEM_KIB,
        it: KDF_IT,
        par: KDF_PAR,
    };
    let key = derive_key(password, &salt, &kdf)?;

    let signing_key = SigningKey::from_bytes(seed);
    let vk = signing_key.verifying_key();
    let pub_key_bytes = vk.as_bytes();
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(pub_key_bytes);
    let pub_encoded = encode_multibase(&prefixed);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let payload = aes_gcm::aead::Payload {
        msg: seed.as_ref(),
        aad: AAD,
    };
    let ciphertext = cipher
        .encrypt(
            aes_gcm::aead::generic_array::GenericArray::from_slice(&nonce),
            payload,
        )
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let ct_len = ciphertext.len() - TAG_LEN;
    let ct = &ciphertext[..ct_len];
    let tag = &ciphertext[ct_len..];

    let engine = base64url_no_pad();
    Ok(AegisBundle {
        pub_key: pub_encoded,
        salt: engine.encode(salt),
        nonce: engine.encode(nonce),
        ct: engine.encode(ct),
        tag: engine.encode(tag),
        kdf,
    })
}

/// Decrypt an Aegis bundle with the password, returning the 32-byte seed.
pub fn decrypt_aegis_bundle(bundle: &AegisBundle, password: &str) -> Result<[u8; 32], String> {
    let engine = base64url_no_pad();
    let salt = engine
        .decode(&bundle.salt)
        .map_err(|_| "Aegis malformed: invalid base64 for salt")?;
    if salt.len() < 8 {
        return Err("Aegis malformed: salt too short".to_string());
    }
    let nonce = engine
        .decode(&bundle.nonce)
        .map_err(|_| "Aegis malformed: invalid base64 for nonce")?;
    if nonce.len() != 12 {
        return Err("Aegis malformed: nonce must be 12 bytes".to_string());
    }
    let ct = engine
        .decode(&bundle.ct)
        .map_err(|_| "Aegis malformed: invalid base64 for ct")?;
    let tag = engine
        .decode(&bundle.tag)
        .map_err(|_| "Aegis malformed: invalid base64 for tag")?;

    let key = derive_key(password, &salt, &bundle.kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let mut ct_with_tag = ct;
    ct_with_tag.extend_from_slice(&tag);

    let payload = aes_gcm::aead::Payload {
        msg: &ct_with_tag,
        aad: AAD,
    };

    let seed = cipher
        .decrypt(
            aes_gcm::aead::generic_array::GenericArray::from_slice(&nonce),
            payload,
        )
        .map_err(|_| "Aegis decryption failed: wrong password or corrupted bundle")?;

    if seed.len() != 32 {
        return Err(format!("Invalid decrypted seed length: {}", seed.len()));
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&seed);
    Ok(arr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn create_and_decrypt_aegis_roundtrip() {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        let password = "test password";

        let bundle = create_aegis_bundle(&seed, password).unwrap();
        let decrypted = decrypt_aegis_bundle(&bundle, password).unwrap();
        assert_eq!(decrypted, seed);
    }

    #[test]
    fn decrypt_aegis_wrong_password_fails() {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        let bundle = create_aegis_bundle(&seed, "correct").unwrap();
        assert!(decrypt_aegis_bundle(&bundle, "wrong").is_err());
    }
}
