/**
 * Derive persona ID from a multibase-encoded Ed25519 public key.
 * Matches Syner's persona_id_from_public_key logic: multibase(ED25519_MULTICODEC_PREFIX || raw_public_key).
 */
import {
  decodePublicKey,
  encodeMultibase,
  ED25519_MULTICODEC_PREFIX,
} from "./wasm-adapter.js";

/**
 * Derive persona ID (folder name) from a multibase-encoded Ed25519 public key.
 * Used for Syner persona folder structure.
 *
 * @param publicKeyMultibase - Multibase-encoded public key (e.g. from IdentityExportBundle)
 * @returns Persona ID string (multibase of prefix + raw key)
 */
export function personaIdFromPublicKey(publicKeyMultibase: string): string {
  const rawBytes = decodePublicKey(publicKeyMultibase);
  if (rawBytes.length !== 32) {
    throw new Error("Public key must be 32 bytes");
  }
  const prefixed = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + rawBytes.length,
  );
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(rawBytes, ED25519_MULTICODEC_PREFIX.length);
  return encodeMultibase(prefixed);
}
