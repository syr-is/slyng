import { describe, it, expect } from "vitest";
import {
  encodeMultibase,
  decodeMultibase,
  decodePublicKey,
  decodePrivateKey,
  deriveDid,
  ED25519_MULTICODEC_PREFIX,
  ED25519_PRIV_MULTICODEC_PREFIX,
  generateRootKeypair,
  concatBytes,
} from "../index.js";

describe("encodeMultibase / decodeMultibase", () => {
  it("roundtrips arbitrary bytes", () => {
    const original = new Uint8Array([0xed, 0x01, 10, 20, 30]);
    const encoded = encodeMultibase(original);
    expect(encoded.startsWith("z")).toBe(true);
    const decoded = decodeMultibase(encoded);
    expect(decoded).toEqual(original);
  });

  it("throws on empty input", () => {
    expect(() => decodeMultibase("")).toThrow("Empty input");
  });

  it("throws on wrong prefix", () => {
    expect(() => decodeMultibase("m" + "AAAA")).toThrow(
      "Unsupported multibase prefix",
    );
  });
});

describe("deriveDid", () => {
  it("produces a valid did:syr:z... string", async () => {
    const kp = await generateRootKeypair();
    const did = deriveDid(kp.publicKey);
    expect(did).toMatch(/^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("is deterministic for the same key", async () => {
    const kp = await generateRootKeypair();
    expect(deriveDid(kp.publicKey)).toBe(deriveDid(kp.publicKey));
  });

  it("throws for non-32-byte key", () => {
    expect(() => deriveDid(new Uint8Array(16))).toThrow(/32.byte/);
  });

  it("produces different DIDs for different keys", async () => {
    const a = await generateRootKeypair();
    const b = await generateRootKeypair();
    expect(deriveDid(a.publicKey)).not.toBe(deriveDid(b.publicKey));
  });
});

describe("decodePublicKey", () => {
  it("decodes a multibase-encoded Ed25519 public key with multicodec prefix", async () => {
    const kp = await generateRootKeypair();
    const prefixed = concatBytes(ED25519_MULTICODEC_PREFIX, kp.publicKey);
    const encoded = encodeMultibase(prefixed);
    const decoded = decodePublicKey(encoded);
    expect(decoded.length).toBe(32);
    expect(decoded).toEqual(kp.publicKey);
  });

  it("decodes raw 32-byte multibase (no multicodec prefix)", () => {
    const raw = new Uint8Array(32).fill(42);
    const encoded = encodeMultibase(raw);
    const decoded = decodePublicKey(encoded);
    expect(decoded).toEqual(raw);
  });

  it("throws for wrong length", () => {
    const short = new Uint8Array(16);
    const encoded = encodeMultibase(short);
    expect(() => decodePublicKey(encoded)).toThrow("Invalid public key length");
  });
});

describe("decodePrivateKey", () => {
  it("decodes a multibase-encoded Ed25519 private key with multicodec prefix", async () => {
    const kp = await generateRootKeypair();
    const prefixed = concatBytes(ED25519_PRIV_MULTICODEC_PREFIX, kp.privateKey);
    const encoded = encodeMultibase(prefixed);
    const decoded = decodePrivateKey(encoded);
    expect(decoded.length).toBe(32);
    expect(decoded).toEqual(kp.privateKey);
  });

  it("throws for wrong length", () => {
    const short = new Uint8Array(10);
    const encoded = encodeMultibase(short);
    expect(() => decodePrivateKey(encoded)).toThrow(
      "Invalid private key length",
    );
  });
});
