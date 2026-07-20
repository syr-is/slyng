//! WASM bindings for Syr crypto.

use wasm_bindgen::prelude::*;

use syr_crypto_aegis::{create_aegis_bundle, decrypt_aegis_bundle, AegisBundle};
use syr_crypto_core::{
    canonical::canonicalize,
    encoding::{
        decode_multibase, decode_private_key, decode_public_key, derive_did, encode_multibase,
        encode_private_key, ED25519_MULTICODEC_PREFIX, ED25519_PRIV_MULTICODEC_PREFIX,
    },
    keys::{constant_time_equal, generate_device_keypair, generate_root_keypair, sign, verify},
    rotation::{
        create_rotation_statement, genesis_key_from_did, genesis_root_multibase,
        verify_rotation_chain, RotationStatement,
    },
};
use syr_crypto_sigil::{create_sigil, decrypt_sigil, SigilObject};
use syr_did::{build_did_document, is_valid_syr_did, parse_did, BuildDidDocumentInput};

// ---- Keys ----

#[wasm_bindgen]
pub fn generate_root_keypair_wasm() -> JsValue {
    let (pub_k, priv_k) = generate_root_keypair();
    let arr: [u8; 64] = {
        let mut a = [0u8; 64];
        a[..32].copy_from_slice(&pub_k);
        a[32..].copy_from_slice(&priv_k);
        a
    };
    js_sys::Uint8Array::from(&arr[..]).into()
}

#[wasm_bindgen]
pub fn generate_device_keypair_wasm() -> JsValue {
    let (pub_k, priv_k) = generate_device_keypair();
    let arr: [u8; 64] = {
        let mut a = [0u8; 64];
        a[..32].copy_from_slice(&pub_k);
        a[32..].copy_from_slice(&priv_k);
        a
    };
    js_sys::Uint8Array::from(&arr[..]).into()
}

#[wasm_bindgen]
pub fn sign_wasm(payload: &[u8], private_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let pk: [u8; 32] = private_key
        .try_into()
        .map_err(|_| JsValue::from_str("Private key must be 32 bytes"))?;
    sign(payload, &pk)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn verify_wasm(payload: &[u8], signature: &[u8], public_key: &[u8]) -> bool {
    let pk: [u8; 32] = match public_key.try_into() {
        Ok(p) => p,
        Err(_) => return false,
    };
    verify(payload, signature, &pk)
}

#[wasm_bindgen]
pub fn constant_time_equal_wasm(a: &[u8], b: &[u8]) -> bool {
    constant_time_equal(a, b)
}

// ---- Encoding ----

#[wasm_bindgen]
pub fn encode_multibase_wasm(bytes: &[u8]) -> String {
    encode_multibase(bytes)
}

#[wasm_bindgen]
pub fn decode_multibase_wasm(encoded: &str) -> Result<Vec<u8>, JsValue> {
    decode_multibase(encoded).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn decode_public_key_wasm(encoded: &str) -> Result<Vec<u8>, JsValue> {
    decode_public_key(encoded)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn decode_private_key_wasm(encoded: &str) -> Result<Vec<u8>, JsValue> {
    decode_private_key(encoded)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn encode_private_key_wasm(raw: &[u8]) -> Result<String, JsValue> {
    let arr: [u8; 32] = raw
        .try_into()
        .map_err(|_| JsValue::from_str("Expected 32-byte key"))?;
    Ok(encode_private_key(&arr))
}

#[wasm_bindgen]
pub fn derive_did_wasm(public_key: &[u8]) -> Result<String, JsValue> {
    let pk: [u8; 32] = public_key
        .try_into()
        .map_err(|_| JsValue::from_str("Public key must be 32 bytes"))?;
    Ok(derive_did(&pk))
}

#[wasm_bindgen]
pub fn ed25519_multicodec_prefix_wasm() -> Vec<u8> {
    ED25519_MULTICODEC_PREFIX.to_vec()
}

#[wasm_bindgen]
pub fn ed25519_priv_multicodec_prefix_wasm() -> Vec<u8> {
    ED25519_PRIV_MULTICODEC_PREFIX.to_vec()
}

// ---- Canonical ----

#[wasm_bindgen]
pub fn canonicalize_wasm(obj_json: &str) -> Result<String, JsValue> {
    let obj: serde_json::Value = serde_json::from_str(obj_json)
        .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
    let map = obj
        .as_object()
        .ok_or_else(|| JsValue::from_str("Expected JSON object"))?;
    let mut rust_map: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    for (k, v) in map {
        rust_map.insert(k.clone(), v.clone());
    }
    canonicalize(&rust_map).map_err(|e| JsValue::from_str(&e))
}

// ---- Rotation (v2 + chain) ----

#[wasm_bindgen]
pub fn create_rotation_statement_wasm(
    did: &str,
    seq: u32,
    prev_root: &str,
    new_public_key: &[u8],
    current_private_key: &[u8],
) -> Result<String, JsValue> {
    let pk: [u8; 32] = new_public_key
        .try_into()
        .map_err(|_| JsValue::from_str("New public key must be 32 bytes"))?;
    let priv_k: [u8; 32] = current_private_key
        .try_into()
        .map_err(|_| JsValue::from_str("Current private key must be 32 bytes"))?;
    let stmt = create_rotation_statement(did, seq, prev_root, &pk, &priv_k)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&stmt).map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))
}

/// Verify a full rotation chain and return the current root key (32 bytes).
/// `statements_json` is a JSON array of rotation statements.
#[wasm_bindgen]
pub fn verify_rotation_chain_wasm(did: &str, statements_json: &str) -> Result<Vec<u8>, JsValue> {
    let statements: Vec<RotationStatement> = serde_json::from_str(statements_json)
        .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
    verify_rotation_chain(did, &statements)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

/// The genesis root key (32 raw bytes) embedded in a did:syr identifier.
#[wasm_bindgen]
pub fn genesis_key_from_did_wasm(did: &str) -> Result<Vec<u8>, JsValue> {
    genesis_key_from_did(did)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

/// The genesis root multibase (the DID's method-specific id, canonicalized) —
/// the expected `prevRoot` for the first rotation statement.
#[wasm_bindgen]
pub fn genesis_root_multibase_wasm(did: &str) -> Result<String, JsValue> {
    genesis_root_multibase(did).map_err(|e| JsValue::from_str(&e))
}

// ---- Sigil ----

#[wasm_bindgen]
pub fn create_sigil_wasm(seed: &[u8], passphrase: &str) -> Result<String, JsValue> {
    let s: [u8; 32] = seed
        .try_into()
        .map_err(|_| JsValue::from_str("Seed must be 32 bytes"))?;
    let obj = create_sigil(&s, passphrase).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&obj).map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn decrypt_sigil_wasm(sigil_json: &str, passphrase: &str) -> Result<Vec<u8>, JsValue> {
    let obj: SigilObject = serde_json::from_str(sigil_json)
        .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
    decrypt_sigil(&obj, passphrase)
        .map(|arr| arr.as_ref().to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

// ---- Aegis ----

#[wasm_bindgen]
pub fn create_aegis_bundle_wasm(seed: &[u8], password: &str) -> Result<String, JsValue> {
    let s: [u8; 32] = seed
        .try_into()
        .map_err(|_| JsValue::from_str("Seed must be 32 bytes"))?;
    let bundle = create_aegis_bundle(&s, password).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&bundle).map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn decrypt_aegis_bundle_wasm(bundle_json: &str, password: &str) -> Result<Vec<u8>, JsValue> {
    let bundle: AegisBundle = serde_json::from_str(bundle_json)
        .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
    decrypt_aegis_bundle(&bundle, password)
        .map(|arr| arr.to_vec())
        .map_err(|e| JsValue::from_str(&e))
}

// ---- DID ----

#[wasm_bindgen]
pub fn parse_did_wasm(did: &str) -> Result<JsValue, JsValue> {
    let parsed = parse_did(did).map_err(|e| JsValue::from_str(&e))?;
    let obj = serde_json::json!({
        "method": parsed.method,
        "id": parsed.id,
        "publicKey": parsed.public_key.to_vec()
    });
    serde_wasm_bindgen::to_value(&obj).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn build_did_document_wasm(
    did: &str,
    public_key_multibase: &str,
    service_endpoint: Option<String>,
) -> Result<String, JsValue> {
    let input = BuildDidDocumentInput {
        did,
        public_key_multibase,
        service_endpoint: service_endpoint.as_deref(),
    };
    let doc = build_did_document(input);
    serde_json::to_string(&doc).map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn is_valid_syr_did_wasm(did: &str) -> bool {
    is_valid_syr_did(did)
}
