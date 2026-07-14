import { describe, it, expect } from "vitest";
import { generateRootKeypair } from "../index.js";
import { createSigil, decryptSigil, type SigilObject } from "../sigil.js";

describe("sigil", () => {
  it("round-trip: seed → createSigil → decryptSigil → seed matches", async () => {
    const kp = await generateRootKeypair();
    const seed = kp.privateKey;
    const passphrase = "export-passphrase-xyz";

    const sigil = await createSigil(seed, passphrase);
    expect(sigil.v).toBe(1);
    expect(sigil.pub).toBeDefined();
    expect(sigil.kdf.name).toBe("argon2id");
    expect(sigil.kdf.salt).toBeDefined();
    expect(sigil.enc.name).toBe("aes-256-gcm");
    expect(sigil.enc.nonce).toBeDefined();
    expect(sigil.enc.ct).toBeDefined();
    expect(sigil.enc.tag).toBeDefined();

    const recovered = await decryptSigil(sigil, passphrase);
    expect(recovered).toEqual(seed);
  });

  it("rejects wrong passphrase", async () => {
    const kp = await generateRootKeypair();
    const sigil = await createSigil(kp.privateKey, "correct");
    await expect(decryptSigil(sigil, "wrong")).rejects.toThrow(
      "Sigil decryption failed",
    );
  });

  it("rejects tampered ciphertext (public key mismatch)", async () => {
    const kp = await generateRootKeypair();
    const sigil = await createSigil(kp.privateKey, "pass");
    const tampered: SigilObject = {
      ...sigil,
      enc: {
        ...sigil.enc,
        ct: sigil.enc.ct.slice(0, -2) + "XX",
      },
    };
    await expect(decryptSigil(tampered, "pass")).rejects.toThrow(
      /Sigil malformed|Sigil decryption failed|public key mismatch/,
    );
  });

  it("rejects unsupported version", async () => {
    const kp = await generateRootKeypair();
    const sigil = await createSigil(kp.privateKey, "pass");
    await expect(
      decryptSigil({ ...sigil, v: 99 } as SigilObject, "pass"),
    ).rejects.toThrow("Unsupported Sigil version");
  });

  it("rejects seed not 32 bytes", async () => {
    await expect(createSigil(new Uint8Array(16), "pass")).rejects.toThrow(
      /32.byte.seed|Seed must be 32 bytes/,
    );
  });
});
