/**
 * Web Crypto API helpers for Ed25519.
 * Key generation, signing, and export/import for storage. No storage or encryption — callers handle persistence.
 */

const ED25519_ALGO: AlgorithmIdentifier = { name: "Ed25519" };
const ED25519_SIGN_ALGO: AlgorithmIdentifier = { name: "Ed25519" };

export interface WebCryptoKeyPair {
  /** Raw 32-byte Ed25519 public key for use in KeyRecord / DID. */
  publicKey: Uint8Array;
  /** Web Crypto private key; use signWithCryptoKey or exportPrivateKeyForStorage. */
  privateKey: CryptoKey;
}

/**
 * Generate an Ed25519 keypair using the Web Crypto API.
 * Private key is extractable so the adapter can export it for encrypted storage.
 */
export async function generateEd25519KeyPairWebCrypto(): Promise<WebCryptoKeyPair> {
  const pair = (await crypto.subtle.generateKey(ED25519_ALGO, true, [
    "sign",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey!),
  );
  return { publicKey, privateKey: pair.privateKey! };
}

/**
 * Sign a payload with a Web Crypto Ed25519 private key.
 * @param payload - The data to sign (string or Uint8Array). Strings are encoded as UTF-8.
 * @param privateKey - The Ed25519 CryptoKey (private).
 * @returns The Ed25519 signature (64 bytes).
 */
export async function signWithCryptoKey(
  payload: Uint8Array | string,
  privateKey: CryptoKey,
): Promise<Uint8Array> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const sig = await crypto.subtle.sign(
    ED25519_SIGN_ALGO,
    privateKey,
    data as BufferSource,
  );
  return new Uint8Array(sig);
}

/**
 * Export a Web Crypto Ed25519 private key to PKCS8 for storage.
 * Caller is responsible for encrypting and persisting the returned buffer.
 */
export async function exportPrivateKeyForStorage(
  privateKey: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("pkcs8", privateKey);
}

/**
 * Import an Ed25519 private key from PKCS8 bytes (e.g. after decrypting from storage).
 * Key is imported as non-extractable for in-memory signing.
 */
export async function importPrivateKeyFromStorage(
  pkcs8: ArrayBuffer,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, [
    "sign",
  ]);
}
