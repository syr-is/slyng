import { describe, it, expect } from "vitest";
import { generateRootKeypair } from "../index.js";
import {
  createAegisBundle,
  decryptAegisBundle,
  type AegisBundle,
} from "../aegis.js";

describe("aegis", () => {
  it("round-trip: seed → createAegisBundle → decryptAegisBundle → seed matches", async () => {
    const kp = await generateRootKeypair();
    const seed = kp.privateKey;
    const password = "test-password-123";

    const bundle = await createAegisBundle(seed, password);
    expect(bundle.pub).toBeDefined();
    expect(bundle.salt).toBeDefined();
    expect(bundle.nonce).toBeDefined();
    expect(bundle.ct).toBeDefined();
    expect(bundle.tag).toBeDefined();
    expect(bundle.kdf).toEqual({ mem: 65536, it: 3, par: 1 });

    const recovered = await decryptAegisBundle(bundle, password);
    expect(recovered).toEqual(seed);
  });

  it("rejects wrong password", async () => {
    const kp = await generateRootKeypair();
    const bundle = await createAegisBundle(kp.privateKey, "correct");
    await expect(decryptAegisBundle(bundle, "wrong")).rejects.toThrow(
      "Aegis decryption failed",
    );
  });

  it("rejects tampered ciphertext", async () => {
    const kp = await generateRootKeypair();
    const bundle = await createAegisBundle(kp.privateKey, "pass");
    // Tamper the tag so GCM authentication fails (use valid base64)
    const tampered: AegisBundle = {
      ...bundle,
      tag: bundle.tag.slice(0, -1) + (bundle.tag.slice(-1) === "A" ? "B" : "A"),
    };
    await expect(decryptAegisBundle(tampered, "pass")).rejects.toThrow(/Aegis/);
  });

  it("rejects seed not 32 bytes", async () => {
    await expect(createAegisBundle(new Uint8Array(16), "pass")).rejects.toThrow(
      /32.byte.seed|Seed must be 32 bytes/,
    );
  });
});
