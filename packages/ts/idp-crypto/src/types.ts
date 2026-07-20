/**
 * An Ed25519 keypair.
 */
export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * A rotation statement (v2), signed by the RETIRING (`prevRoot`) key,
 * authorizing a new root key to succeed it. Statements chain by `seq`.
 */
export interface RotationStatement {
  did: string;
  seq: number; // 1-based, strictly increasing, no gaps
  prevRoot: string; // multibase of the retiring key (genesis for seq === 1)
  newRoot: string; // multibase of the incoming root key
  rotatedAt: string; // ISO 8601 timestamp (RFC 3339)
  signature: string; // multibase-encoded Ed25519 signature over the JCS payload
}

/** An ordered rotation chain for a single DID. */
export type RotationChain = RotationStatement[];

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
