import { describe, it, expect } from "vitest";
import {
  generateRootKeypair,
  generateDeviceKeypair,
  sign,
  verify,
  constantTimeEqual,
} from "../index.js";

describe("generateRootKeypair", () => {
  it("returns 32-byte public and private keys", async () => {
    const kp = await generateRootKeypair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it("generates unique keypairs on each call", async () => {
    const a = await generateRootKeypair();
    const b = await generateRootKeypair();
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(a.privateKey).not.toEqual(b.privateKey);
  });
});

describe("generateDeviceKeypair", () => {
  it("returns 32-byte public and private keys", async () => {
    const kp = await generateDeviceKeypair();
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });
});

describe("sign and verify", () => {
  it("roundtrips with a string payload", async () => {
    const kp = await generateRootKeypair();
    const sig = await sign("hello world", kp.privateKey);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    const valid = await verify("hello world", sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it("roundtrips with a Uint8Array payload", async () => {
    const kp = await generateRootKeypair();
    const payload = new TextEncoder().encode("binary payload");
    const sig = await sign(payload, kp.privateKey);
    const valid = await verify(payload, sig, kp.publicKey);
    expect(valid).toBe(true);
  });

  it("fails verification with wrong public key", async () => {
    const kp1 = await generateRootKeypair();
    const kp2 = await generateRootKeypair();
    const sig = await sign("test", kp1.privateKey);
    const valid = await verify("test", sig, kp2.publicKey);
    expect(valid).toBe(false);
  });

  it("fails verification with wrong payload", async () => {
    const kp = await generateRootKeypair();
    const sig = await sign("original", kp.privateKey);
    const valid = await verify("tampered", sig, kp.publicKey);
    expect(valid).toBe(false);
  });

  it("fails verification with tampered signature", async () => {
    const kp = await generateRootKeypair();
    const sig = await sign("test", kp.privateKey);
    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0xff;
    const valid = await verify("test", tampered, kp.publicKey);
    expect(valid).toBe(false);
  });

  it("handles empty string payload", async () => {
    const kp = await generateRootKeypair();
    const sig = await sign("", kp.privateKey);
    const valid = await verify("", sig, kp.publicKey);
    expect(valid).toBe(true);
  });
});

describe("constantTimeEqual", () => {
  it("returns true for equal arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it("returns false for unequal arrays of same length", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("returns false for arrays of different lengths", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("returns true for empty arrays", () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
