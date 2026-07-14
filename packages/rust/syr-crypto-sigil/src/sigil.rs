//! Sigil creation and decryption.

use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm};
use argon2::Argon2;
use base64::Engine;
use ed25519_dalek::SigningKey;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use syr_crypto_core::encoding::{encode_multibase, ED25519_MULTICODEC_PREFIX};

const AAD: &[u8] = b"pief:v1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KDF_MEM_KIB: u32 = 65536;
const KDF_IT: u32 = 3;
const KDF_PAR: u32 = 1;
const KEY_LEN: usize = 32;

const MAX_ARGON2_MEMORY: u32 = 262144;
const MAX_ARGON2_ITERS: u32 = 10;
const MAX_ARGON2_PARALLELISM: u32 = 4;

fn base64url_no_pad() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigilKdf {
    pub name: String,
    pub salt: String,
    pub mem: u32,
    pub it: u32,
    pub par: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigilEnc {
    pub name: String,
    pub nonce: String,
    pub ct: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigilObject {
    pub v: u32,
    pub kdf: SigilKdf,
    pub enc: SigilEnc,
    #[serde(rename = "pub")]
    pub pub_key: String,
}

fn derive_key(
    passphrase: &str,
    salt: &[u8],
    mem: u32,
    it: u32,
    par: u32,
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let pw = Zeroizing::new(passphrase.nfkc().collect::<String>());
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(mem, it, par, None).map_err(|e| e.to_string())?,
    );
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(pw.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(Zeroizing::new(key))
}

/// Create a Sigil from a 32-byte seed and passphrase.
pub fn create_sigil(seed: &[u8; 32], passphrase: &str) -> Result<SigilObject, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    let key = derive_key(passphrase, &salt, KDF_MEM_KIB, KDF_IT, KDF_PAR)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|e| e.to_string())?;
    let signing_key = SigningKey::from_bytes(seed);
    let vk = signing_key.verifying_key();
    let pub_key_bytes = vk.as_bytes();

    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(pub_key_bytes);
    let pub_encoded = encode_multibase(&prefixed);

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

    // AES-GCM produces ciphertext || tag
    let ct_len = ciphertext.len() - TAG_LEN;
    let ct = &ciphertext[..ct_len];
    let tag = &ciphertext[ct_len..];

    let engine = base64url_no_pad();
    Ok(SigilObject {
        v: 1,
        kdf: SigilKdf {
            name: "argon2id".to_string(),
            salt: engine.encode(salt),
            mem: KDF_MEM_KIB,
            it: KDF_IT,
            par: KDF_PAR,
        },
        enc: SigilEnc {
            name: "aes-256-gcm".to_string(),
            nonce: engine.encode(nonce),
            ct: engine.encode(ct),
            tag: engine.encode(tag),
        },
        pub_key: pub_encoded,
    })
}

/// Decrypt a Sigil with the passphrase, returning the 32-byte seed (zeroized on drop).
pub fn decrypt_sigil(sigil: &SigilObject, passphrase: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    if sigil.v != 1 {
        return Err(format!("Unsupported Sigil version: {}", sigil.v));
    }
    if sigil.kdf.name != "argon2id" || sigil.enc.name != "aes-256-gcm" {
        return Err("Unsupported KDF or cipher in Sigil".to_string());
    }

    let engine = base64url_no_pad();
    let salt = engine
        .decode(&sigil.kdf.salt)
        .map_err(|_| "Sigil malformed: invalid base64 for salt")?;
    if salt.len() < 8 {
        return Err("Sigil malformed: salt too short".to_string());
    }
    let nonce = engine
        .decode(&sigil.enc.nonce)
        .map_err(|_| "Sigil malformed: invalid base64 for nonce")?;
    if nonce.len() != 12 {
        return Err("Sigil malformed: nonce must be 12 bytes".to_string());
    }
    let ct = engine
        .decode(&sigil.enc.ct)
        .map_err(|_| "Sigil malformed: invalid base64 for ct")?;
    let tag = engine
        .decode(&sigil.enc.tag)
        .map_err(|_| "Sigil malformed: invalid base64 for tag")?;

    let mem = sigil.kdf.mem;
    let it = sigil.kdf.it;
    let par = sigil.kdf.par;
    if !(1..=MAX_ARGON2_MEMORY).contains(&mem)
        || !(1..=MAX_ARGON2_ITERS).contains(&it)
        || !(1..=MAX_ARGON2_PARALLELISM).contains(&par)
    {
        return Err(
            "Invalid Sigil KDF parameters: mem/it/par must be positive integers within safe bounds"
                .to_string(),
        );
    }

    let key = derive_key(passphrase, &salt, mem, it, par)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|e| e.to_string())?;

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
        .map_err(|_| "Sigil decryption failed: wrong passphrase or corrupted data")?;

    if seed.len() != 32 {
        return Err(format!("Invalid decrypted seed length: {}", seed.len()));
    }

    let signing_key = SigningKey::from_bytes(seed.as_slice().try_into().unwrap());
    let vk = signing_key.verifying_key();
    let derived_pub = vk.as_bytes();
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(derived_pub);
    let derived_pub_encoded = encode_multibase(&prefixed);

    if derived_pub_encoded != sigil.pub_key {
        return Err("Sigil public key mismatch: decryption or data tampered".to_string());
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&seed);
    Ok(Zeroizing::new(arr))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn create_and_decrypt_sigil_roundtrip() {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        let passphrase = "test passphrase";

        let sigil = create_sigil(&seed, passphrase).unwrap();
        assert_eq!(sigil.v, 1);
        assert_eq!(sigil.kdf.name, "argon2id");

        let decrypted = decrypt_sigil(&sigil, passphrase).unwrap();
        assert_eq!(decrypted.as_ref(), &seed);
    }

    #[test]
    fn decrypt_sigil_wrong_passphrase_fails() {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        let sigil = create_sigil(&seed, "correct").unwrap();
        assert!(decrypt_sigil(&sigil, "wrong").is_err());
    }
}
