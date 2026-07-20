/**
 * @slyng/idp-crypto
 * Cryptographic primitives for the Syr identity system, vendored from syr's
 * @syr-is/crypto (packages/ts/crypto) for slyng's identity-provider role.
 * Ed25519 key generation, multibase encoding, signing, verification, and JCS canonicalization.
 * Requires initCryptoWasm() before use.
 *
 * Single-entry package: Aegis (CIGP) and Sigil (PIEF) are exported here rather
 * than as subpaths — the tsup bundle would otherwise duplicate the adapter's
 * module-level WASM state per entry.
 */

export { initCryptoWasm } from "./wasm-adapter.js";
export {
  generateRootKeypair,
  generateDeviceKeypair,
  sign,
  verify,
  constantTimeEqual,
  encodeMultibase,
  decodeMultibase,
  decodePublicKey,
  decodePrivateKey,
  encodePrivateKey,
  deriveDid,
  ED25519_MULTICODEC_PREFIX,
  ED25519_PRIV_MULTICODEC_PREFIX,
  canonicalize,
  createRotationStatement,
  verifyRotationChain,
  genesisKeyFromDid,
  genesisRootMultibase,
} from "./wasm-adapter.js";

export {
  generateEd25519KeyPairWebCrypto,
  signWithCryptoKey,
  exportPrivateKeyForStorage,
  importPrivateKeyFromStorage,
} from "./webcrypto.js";

export { personaIdFromPublicKey } from "./persona-id.js";

export { isValidSyrDid, parseDid, buildDidDocument } from "./wasm-adapter.js";
export type {
  ParsedDid,
  DidDocument,
  VerificationMethod,
  ServiceEndpoint,
} from "./wasm-adapter.js";

export { createAegisBundle, decryptAegisBundle } from "./aegis.js";
export type { AegisKdfParams, AegisBundle } from "./aegis.js";

export { createSigil, decryptSigil } from "./sigil.js";
export type { SigilKdf, SigilEnc, SigilObject } from "./sigil.js";

export type { Keypair, RotationStatement, RotationChain } from "./types.js";
export * from "./utils.js";
