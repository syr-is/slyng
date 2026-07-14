/**
 * Multicodec prefix for Ed25519 public keys.
 * varint 0xed = [0xed, 0x01]
 */
export const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Multicodec prefix for Ed25519 private keys.
 * varint 0x1300 = [0x80, 0x26]
 */
export const ED25519_PRIV_MULTICODEC_PREFIX = new Uint8Array([0x80, 0x26]);
