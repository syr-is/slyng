/**
 * WASM adapter for Syr crypto. Requires initCryptoWasm() before use.
 */

import type {
  Keypair,
  RotationStatement,
  SigilObject,
  AegisBundle,
} from "./types.js";

let wasm: Awaited<typeof import("@slyng/idp-crypto/wasm")> | null = null;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize the WASM crypto module. Call early in app lifecycle (e.g. root layout).
 * Safe to call multiple times. Throws if WebAssembly is unavailable or init fails.
 */
export async function initCryptoWasm(): Promise<void> {
  if (wasm) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    if (typeof globalThis.WebAssembly === "undefined") {
      throw new Error("WebAssembly is not supported in this environment");
    }
    const mod = await import("@slyng/idp-crypto/wasm");
    // Node build loads WASM synchronously; web build has async default init
    if (typeof mod.default === "function") {
      await mod.default();
    }
    wasm = mod;
  })();

  return wasmInitPromise;
}

function getWasm() {
  if (!wasm) {
    throw new Error(
      "Crypto WASM not initialized. Call initCryptoWasm() before using crypto functions.",
    );
  }
  return wasm;
}

// ---- Keys ----

export async function generateRootKeypair(): Promise<Keypair> {
  const arr = getWasm().generate_root_keypair_wasm();
  return {
    publicKey: arr.slice(0, 32),
    privateKey: arr.slice(32, 64),
  };
}

export async function generateDeviceKeypair(): Promise<Keypair> {
  const arr = getWasm().generate_device_keypair_wasm();
  return {
    publicKey: arr.slice(0, 32),
    privateKey: arr.slice(32, 64),
  };
}

export async function sign(
  payload: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return getWasm().sign_wasm(data, privateKey);
}

export async function verify(
  payload: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return getWasm().verify_wasm(data, signature, publicKey);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return getWasm().constant_time_equal_wasm(a, b);
}

// ---- Encoding ----

export function encodeMultibase(bytes: Uint8Array): string {
  return getWasm().encode_multibase_wasm(bytes);
}

/**
 * Decode a multibase base58btc string to bytes.
 * @throws {Error} Invalid input (e.g. wrong prefix, malformed encoding).
 */
export function decodeMultibase(encoded: string): Uint8Array {
  try {
    return getWasm().decode_multibase_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Decode a multibase-encoded Ed25519 public key.
 * @throws {Error} Invalid input (e.g. wrong multicodec prefix, wrong length).
 */
export function decodePublicKey(encoded: string): Uint8Array {
  try {
    return getWasm().decode_public_key_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Decode a multibase-encoded Ed25519 private key.
 * @throws {Error} Invalid input (e.g. wrong multicodec prefix, wrong length).
 */
export function decodePrivateKey(encoded: string): Uint8Array {
  try {
    return getWasm().decode_private_key_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Encode raw private key bytes as multibase.
 * @throws {Error} Invalid input (e.g. wrong length).
 */
export function encodePrivateKey(raw: Uint8Array): string {
  try {
    return getWasm().encode_private_key_wasm(raw);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Derive a did:syr identifier from a 32-byte public key.
 * @throws {Error} Invalid input (e.g. public key not 32 bytes).
 */
export function deriveDid(publicKey: Uint8Array): string {
  try {
    return getWasm().derive_did_wasm(publicKey);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

export {
  ED25519_MULTICODEC_PREFIX,
  ED25519_PRIV_MULTICODEC_PREFIX,
} from "./constants.js";

// ---- Canonical ----

export function canonicalize(obj: Record<string, unknown>): string {
  return getWasm().canonicalize_wasm(JSON.stringify(obj));
}

// ---- Rotation (v2 + chain) ----

/**
 * Create a rotation statement (v2). Signed by the RETIRING key
 * (`currentPrivateKey`, whose multibase is `prevRoot`).
 *
 * @param did The identity (never changes).
 * @param seq 1-based position in the chain.
 * @param prevRoot Multibase of the retiring key (genesis for seq === 1).
 * @param newPublicKey Raw 32-byte incoming root public key.
 * @param currentPrivateKey The retiring key's 32-byte seed.
 */
export async function createRotationStatement(
  did: string,
  seq: number,
  prevRoot: string,
  newPublicKey: Uint8Array,
  currentPrivateKey: Uint8Array,
): Promise<RotationStatement> {
  const json = getWasm().create_rotation_statement_wasm(
    did,
    seq,
    prevRoot,
    newPublicKey,
    currentPrivateKey,
  );
  return JSON.parse(json);
}

/**
 * Verify a full rotation chain for `did` and return the CURRENT root public
 * key (32 raw bytes). An empty chain returns the genesis key.
 * @throws {Error} If the chain is invalid (seq gap, fork, bad signature,
 *   non-genesis start, cross-DID replay, or decreasing rotatedAt).
 */
export function verifyRotationChain(
  did: string,
  statements: RotationStatement[],
): Uint8Array {
  try {
    return getWasm().verify_rotation_chain_wasm(did, JSON.stringify(statements));
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * The genesis root public key (32 raw bytes) embedded in a did:syr identifier.
 * @throws {Error} If the DID is malformed.
 */
export function genesisKeyFromDid(did: string): Uint8Array {
  try {
    return getWasm().genesis_key_from_did_wasm(did);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * The genesis root multibase (the DID's canonical method-specific id) — the
 * expected `prevRoot` for the first rotation statement.
 * @throws {Error} If the DID is malformed.
 */
export function genesisRootMultibase(did: string): string {
  try {
    return getWasm().genesis_root_multibase_wasm(did);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

// ---- Sigil ----

export async function createSigil(
  seed: Uint8Array,
  passphrase: string,
): Promise<SigilObject> {
  const json = getWasm().create_sigil_wasm(seed, passphrase);
  return JSON.parse(json);
}

export async function decryptSigil(
  sigil: SigilObject,
  passphrase: string,
): Promise<Uint8Array> {
  return getWasm().decrypt_sigil_wasm(JSON.stringify(sigil), passphrase);
}

// ---- Aegis ----

export async function createAegisBundle(
  seed: Uint8Array,
  password: string,
): Promise<AegisBundle> {
  const json = getWasm().create_aegis_bundle_wasm(seed, password);
  return JSON.parse(json);
}

export async function decryptAegisBundle(
  bundle: AegisBundle,
  password: string,
): Promise<Uint8Array> {
  return getWasm().decrypt_aegis_bundle_wasm(JSON.stringify(bundle), password);
}

// ---- DID (ported from syr's @syr-is/did package) ----

/** A parsed did:syr identifier. */
export interface ParsedDid {
  /** Always 'syr' for did:syr identifiers */
  method: "syr";
  /** The multibase-encoded method-specific identifier */
  id: string;
  /** The decoded Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;
}

/** An Ed25519 verification method in a DID Document. */
export interface VerificationMethod {
  id: string;
  type: "Ed25519VerificationKey2020";
  controller: string;
  publicKeyMultibase: string;
}

/** A service endpoint in a DID Document. */
export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/**
 * A DID Document for a did:syr identity.
 * Conforms to W3C DID Core; @context is required for JSON-LD.
 */
export interface DidDocument {
  "@context": string | Array<string | Record<string, unknown>>;
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

/**
 * Check if a string is a valid did:syr identifier (syntax, multibase
 * decoding, multicodec prefix, Ed25519 key length).
 */
export function isValidSyrDid(did: string): boolean {
  return getWasm().is_valid_syr_did_wasm(did);
}

/**
 * Parse a did:syr identifier into its components.
 * @throws If the DID format is invalid or the key fails to decode.
 */
export function parseDid(did: string): ParsedDid {
  try {
    const obj = getWasm().parse_did_wasm(did) as Map<string, unknown>;
    const id = obj.get("id") as string;
    const publicKeyArr = obj.get("publicKey") as number[] | Uint8Array;
    return {
      method: "syr",
      id,
      publicKey: new Uint8Array(publicKeyArr),
    };
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Build a DID Document for a did:syr identity (did:syr Method Spec v0.1).
 * The `service` array is only included when `serviceEndpoint` is given.
 */
export function buildDidDocument(input: {
  did: string;
  publicKeyMultibase: string;
  serviceEndpoint?: string;
}): DidDocument {
  try {
    const json = getWasm().build_did_document_wasm(
      input.did,
      input.publicKeyMultibase,
      input.serviceEndpoint ?? null,
    );
    return JSON.parse(json);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}
