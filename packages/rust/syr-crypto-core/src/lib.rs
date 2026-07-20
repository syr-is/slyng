//! Syr crypto core: Ed25519 keys, multibase encoding, signing, canonicalization.

pub mod canonical;
pub mod encoding;
pub mod keys;
pub mod rotation;

pub use canonical::canonicalize;
pub use encoding::{
    decode_multibase, decode_private_key, decode_public_key, derive_did, encode_multibase,
    encode_private_key, ED25519_MULTICODEC_PREFIX, ED25519_PRIV_MULTICODEC_PREFIX,
};
pub use keys::{
    constant_time_equal, derive_public_key_from_seed, generate_device_keypair,
    generate_root_keypair, sign, verify,
};
pub use rotation::{
    create_rotation_statement, encode_root_multibase, genesis_key_from_did, genesis_root_multibase,
    verify_rotation_chain, RotationStatement,
};
