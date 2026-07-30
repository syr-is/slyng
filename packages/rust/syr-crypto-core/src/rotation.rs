//! Root key rotation statements (v2) and chain validation.
//!
//! A rotation statement authorizes a new root key to succeed the current one.
//! Statements are chained: each carries a 1-based `seq`, the multibase of the
//! retiring (`prevRoot`) key, and the multibase of the incoming (`newRoot`)
//! key, and is signed by the retiring key's PRIVATE key over the RFC 8785 (JCS)
//! canonicalization of `{ did, seq, prevRoot, newRoot, rotatedAt }`.
//!
//! The DID never changes — it is always genesis-derived. Statement 1's
//! `prevRoot` MUST equal the genesis key (the key embedded in the DID). The
//! current root of an identity is the last statement's `newRoot` (or the
//! genesis key when the chain is empty).

use serde::{Deserialize, Serialize};

use crate::canonical::canonicalize;
use crate::encoding::{
    decode_multibase, decode_public_key, encode_multibase, ED25519_MULTICODEC_PREFIX,
};
use crate::keys::{sign, verify};

/// A root key rotation statement (v2). Signed by the retiring (`prev_root`) key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationStatement {
    pub did: String,
    /// 1-based, strictly increasing sequence number (no gaps).
    pub seq: u32,
    /// Multibase of the retiring key. For `seq == 1` this equals the genesis key.
    #[serde(rename = "prevRoot")]
    pub prev_root: String,
    /// Multibase of the incoming root key.
    #[serde(rename = "newRoot")]
    pub new_root: String,
    #[serde(rename = "rotatedAt")]
    pub rotated_at: String,
    /// Multibase Ed25519 signature over the JCS payload, by `prev_root`'s key.
    pub signature: String,
}

/// The canonically-signed subset of a rotation statement.
#[derive(Serialize)]
struct RotationPayload<'a> {
    did: &'a str,
    seq: u32,
    #[serde(rename = "prevRoot")]
    prev_root: &'a str,
    #[serde(rename = "newRoot")]
    new_root: &'a str,
    #[serde(rename = "rotatedAt")]
    rotated_at: &'a str,
}

/// Multibase-encode a raw 32-byte Ed25519 public key as a root-key multibase
/// (`z` + base58btc of the multicodec-prefixed key) — the same encoding the
/// DID's method-specific id and every `prevRoot`/`newRoot` use.
pub fn encode_root_multibase(public_key: &[u8; 32]) -> String {
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(public_key);
    encode_multibase(&prefixed)
}

/// The genesis root multibase for a `did:syr:<id>` — its method-specific id.
pub fn genesis_root_multibase(did: &str) -> Result<String, String> {
    let id = did
        .strip_prefix("did:syr:")
        .ok_or_else(|| "DID must start with did:syr:".to_string())?;
    if id.is_empty() {
        return Err("DID is missing its method-specific identifier".to_string());
    }
    // Validate it decodes to a well-formed Ed25519 key, then re-encode
    // canonically so the returned multibase always matches statement encodings.
    let key = decode_public_key(id)?;
    Ok(encode_root_multibase(&key))
}

/// The genesis root key (32 raw bytes) embedded in a `did:syr` identifier.
pub fn genesis_key_from_did(did: &str) -> Result<[u8; 32], String> {
    let id = did
        .strip_prefix("did:syr:")
        .ok_or_else(|| "DID must start with did:syr:".to_string())?;
    decode_public_key(id)
}

/// Create a root key rotation statement (v2).
///
/// * `did` — the identity (never changes).
/// * `seq` — 1-based position of this statement in the chain.
/// * `prev_root` — multibase of the retiring key (genesis for `seq == 1`).
/// * `new_public_key` — raw 32-byte incoming root public key.
/// * `current_private_key` — the retiring key's 32-byte seed; it signs.
pub fn create_rotation_statement(
    did: &str,
    seq: u32,
    prev_root: &str,
    new_public_key: &[u8; 32],
    current_private_key: &[u8; 32],
) -> Result<RotationStatement, String> {
    let new_root = encode_root_multibase(new_public_key);
    let rotated_at = chrono::Utc::now().to_rfc3339();

    let payload = RotationPayload {
        did,
        seq,
        prev_root,
        new_root: &new_root,
        rotated_at: &rotated_at,
    };
    let payload_str = canonicalize(&payload)?;
    let signature_bytes = sign(payload_str.as_bytes(), current_private_key)?;
    let signature = encode_multibase(&signature_bytes);

    Ok(RotationStatement {
        did: did.to_string(),
        seq,
        prev_root: prev_root.to_string(),
        new_root,
        rotated_at,
        signature,
    })
}

/// Verify one statement's signature under its declared `prev_root` key.
fn verify_statement_signature(statement: &RotationStatement) -> Result<bool, String> {
    let prev_key = decode_public_key(&statement.prev_root)?;
    let payload = RotationPayload {
        did: &statement.did,
        seq: statement.seq,
        prev_root: &statement.prev_root,
        new_root: &statement.new_root,
        rotated_at: &statement.rotated_at,
    };
    let payload_str = canonicalize(&payload)?;

    let signature_bytes = decode_multibase(&statement.signature)?;
    if signature_bytes.len() != 64 {
        return Err("Invalid signature length".to_string());
    }
    Ok(verify(payload_str.as_bytes(), &signature_bytes, &prev_key))
}

/// Parse an RFC 3339 timestamp into a comparable UTC instant.
fn parse_rotated_at(s: &str) -> Result<chrono::DateTime<chrono::Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|e| format!("Invalid rotatedAt timestamp: {e}"))
}

/// Verify a full rotation chain for `did` and return the CURRENT root key
/// (32 raw bytes). An empty chain returns the genesis key.
///
/// Validation, per hop `i` (0-based):
/// - `seq` continuity: `statements[i].seq == i + 1` (1-based, no gaps).
/// - link: `prevRoot` equals the prior hop's `newRoot`, or the genesis key for
///   `i == 0`.
/// - `did` binding: every statement's `did` matches (cross-DID replay guard).
/// - signature: valid under `prevRoot`'s key.
/// - `rotatedAt` non-decreasing across hops.
pub fn verify_rotation_chain(
    did: &str,
    statements: &[RotationStatement],
) -> Result<[u8; 32], String> {
    let genesis_multibase = genesis_root_multibase(did)?;
    if statements.is_empty() {
        return genesis_key_from_did(did);
    }

    let mut prev_time: Option<chrono::DateTime<chrono::Utc>> = None;
    for (i, statement) in statements.iter().enumerate() {
        let expected_seq = (i as u32) + 1;
        if statement.seq != expected_seq {
            return Err(format!(
                "Rotation chain seq discontinuity: expected {expected_seq}, got {} at index {i}",
                statement.seq
            ));
        }
        if statement.did != did {
            return Err(format!(
                "Rotation statement {expected_seq} is bound to a different DID"
            ));
        }
        let expected_prev = if i == 0 {
            genesis_multibase.clone()
        } else {
            statements[i - 1].new_root.clone()
        };
        if statement.prev_root != expected_prev {
            return Err(if i == 0 {
                "Rotation chain does not start from the genesis key".to_string()
            } else {
                format!("Rotation chain fork at seq {expected_seq}: prevRoot does not link to the prior newRoot")
            });
        }
        if !verify_statement_signature(statement)? {
            return Err(format!(
                "Rotation statement {expected_seq} signature does not verify under its prevRoot"
            ));
        }
        let this_time = parse_rotated_at(&statement.rotated_at)?;
        if let Some(prev) = prev_time {
            if this_time < prev {
                return Err(format!(
                    "Rotation statement {expected_seq} rotatedAt is before its predecessor"
                ));
            }
        }
        prev_time = Some(this_time);
    }

    decode_public_key(&statements[statements.len() - 1].new_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoding::derive_did;
    use crate::keys::generate_root_keypair;

    /// Build a valid `n`-hop chain, returning (did, statements, keypairs).
    /// keypairs[0] is genesis; keypairs[i] retires at statement i (0-based).
    fn build_chain(n: usize) -> (String, Vec<RotationStatement>, Vec<([u8; 32], [u8; 32])>) {
        let genesis = generate_root_keypair();
        let did = derive_did(&genesis.0);
        let mut keys = vec![genesis];
        for _ in 0..n {
            keys.push(generate_root_keypair());
        }
        let mut statements: Vec<RotationStatement> = Vec::new();
        for i in 0..n {
            let seq = (i as u32) + 1;
            let prev_root = if i == 0 {
                genesis_root_multibase(&did).unwrap()
            } else {
                statements[i - 1].new_root.clone()
            };
            let (new_pub, _) = keys[i + 1];
            let (_, prev_priv) = keys[i];
            statements.push(
                create_rotation_statement(&did, seq, &prev_root, &new_pub, &prev_priv).unwrap(),
            );
        }
        (did, statements, keys)
    }

    #[test]
    fn empty_chain_returns_genesis() {
        let (pubk, _) = generate_root_keypair();
        let did = derive_did(&pubk);
        let current = verify_rotation_chain(&did, &[]).unwrap();
        assert_eq!(current, pubk);
    }

    #[test]
    fn happy_three_hop_chain() {
        let (did, statements, keys) = build_chain(3);
        let current = verify_rotation_chain(&did, &statements).unwrap();
        // Current root is the 3rd successor key (keys[3]).
        assert_eq!(current, keys[3].0);
    }

    #[test]
    fn single_hop_current_is_new_root() {
        let (did, statements, keys) = build_chain(1);
        let current = verify_rotation_chain(&did, &statements).unwrap();
        assert_eq!(current, keys[1].0);
    }

    #[test]
    fn rejects_seq_gap() {
        let (did, mut statements, _) = build_chain(3);
        statements[2].seq = 4; // gap: 1, 2, 4
        assert!(verify_rotation_chain(&did, &statements).is_err());
    }

    #[test]
    fn rejects_seq_not_one_based() {
        let (did, mut statements, _) = build_chain(2);
        statements[0].seq = 0;
        statements[1].seq = 1;
        assert!(verify_rotation_chain(&did, &statements).is_err());
    }

    #[test]
    fn rejects_wrong_signer() {
        let (did, statements, keys) = build_chain(2);
        // Re-sign statement 2 with the wrong (genesis) key instead of keys[1].
        let mut forged = statements.clone();
        let (_, wrong_priv) = keys[0];
        let re = create_rotation_statement(
            &did,
            2,
            &statements[1].prev_root,
            &decode_public_key(&statements[1].new_root).unwrap(),
            &wrong_priv,
        )
        .unwrap();
        forged[1] = re;
        assert!(verify_rotation_chain(&did, &forged).is_err());
    }

    #[test]
    fn rejects_fork_prevroot_mismatch() {
        let (did, mut statements, _) = build_chain(3);
        // Point statement 3's prevRoot at a divergent key (not stmt 2's newRoot).
        let (other_pub, _) = generate_root_keypair();
        statements[2].prev_root = encode_root_multibase(&other_pub);
        assert!(verify_rotation_chain(&did, &statements).is_err());
    }

    #[test]
    fn rejects_first_prevroot_not_genesis() {
        let genesis = generate_root_keypair();
        let did = derive_did(&genesis.0);
        // Statement 1 signed by a non-genesis key claiming a non-genesis prevRoot.
        let rogue = generate_root_keypair();
        let (new_pub, _) = generate_root_keypair();
        let prev_root = encode_root_multibase(&rogue.0);
        let stmt = create_rotation_statement(&did, 1, &prev_root, &new_pub, &rogue.1).unwrap();
        assert!(verify_rotation_chain(&did, &[stmt]).is_err());
    }

    #[test]
    fn rejects_cross_did_replay() {
        let (_, statements, _) = build_chain(2);
        // A different identity replays another DID's chain.
        let (other_pub, _) = generate_root_keypair();
        let other_did = derive_did(&other_pub);
        assert!(verify_rotation_chain(&other_did, &statements).is_err());
    }

    #[test]
    fn rejects_decreasing_rotated_at() {
        let (did, mut statements, keys) = build_chain(2);
        // Re-mint both statements with an explicitly decreasing rotatedAt.
        let genesis_mb = genesis_root_multibase(&did).unwrap();
        let mut s1 = create_rotation_statement(
            &did,
            1,
            &genesis_mb,
            &keys[1].0,
            &keys[0].1,
        )
        .unwrap();
        s1.rotated_at = "2026-01-02T00:00:00+00:00".to_string();
        // Re-sign s1 with its (now-mutated) rotatedAt so the signature is valid
        // and only the ordering rule is violated.
        s1 = resign(&s1, &keys[0].1);
        let mut s2 = create_rotation_statement(
            &did,
            2,
            &s1.new_root,
            &keys[2].0,
            &keys[1].1,
        )
        .unwrap();
        s2.rotated_at = "2026-01-01T00:00:00+00:00".to_string(); // earlier than s1
        s2 = resign(&s2, &keys[1].1);
        statements[0] = s1;
        statements[1] = s2;
        assert!(verify_rotation_chain(&did, &statements).is_err());
    }

    /// Re-sign a (mutated) statement under `priv_key` so only the rule under
    /// test — not the signature — is what fails.
    fn resign(statement: &RotationStatement, priv_key: &[u8; 32]) -> RotationStatement {
        let payload = RotationPayload {
            did: &statement.did,
            seq: statement.seq,
            prev_root: &statement.prev_root,
            new_root: &statement.new_root,
            rotated_at: &statement.rotated_at,
        };
        let payload_str = canonicalize(&payload).unwrap();
        let sig = sign(payload_str.as_bytes(), priv_key).unwrap();
        RotationStatement {
            signature: encode_multibase(&sig),
            ..statement.clone()
        }
    }
}
