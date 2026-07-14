/**
 * An Ed25519 keypair.
 */
export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * A rotation statement signed by the current root key,
 * authorizing a new root key to take over the identity.
 */
export interface RotationStatement {
  did: string;
  newRoot: string; // multibase-encoded new root public key
  rotatedAt: string; // ISO 8601 timestamp
  signature: string; // multibase-encoded Ed25519 signature
}

/** Sigil (PIEF) KDF parameters */
export interface SigilKdf {
  name: string;
  salt: string;
  mem: number;
  it: number;
  par: number;
}

/** Sigil (PIEF) encryption parameters */
export interface SigilEnc {
  name: string;
  nonce: string;
  ct: string;
  tag: string;
}

/** Sigil (PIEF) encrypted object */
export interface SigilObject {
  v: number;
  kdf: SigilKdf;
  enc: SigilEnc;
  pub: string;
}

/** Aegis (CIGP) KDF parameters */
export interface AegisKdfParams {
  mem: number;
  it: number;
  par: number;
}

/** Aegis (CIGP) encrypted bundle */
export interface AegisBundle {
  pub: string;
  salt: string;
  nonce: string;
  ct: string;
  tag: string;
  kdf: AegisKdfParams;
}
