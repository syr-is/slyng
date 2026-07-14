import { describe, it, expect } from "vitest";
import {
  createRotationStatement,
  verifyRotationStatement,
  generateRootKeypair,
  generateDeviceKeypair,
  deriveDid,
} from "../index.js";

describe("rotation statements", () => {
  it("createRotationStatement + verifyRotationStatement roundtrip", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      newKey.publicKey,
      current.privateKey,
    );

    expect(statement.did).toBe(did);
    expect(statement.newRoot).toMatch(/^z/);
    expect(statement.rotatedAt).toBeTruthy();
    expect(statement.signature).toMatch(/^z/);

    const valid = await verifyRotationStatement(statement, current.publicKey);
    expect(valid).toBe(true);
  });

  it("fails verification with wrong public key", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const wrong = await generateDeviceKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      newKey.publicKey,
      current.privateKey,
    );

    const valid = await verifyRotationStatement(statement, wrong.publicKey);
    expect(valid).toBe(false);
  });

  it("fails verification with tampered statement", async () => {
    const current = await generateRootKeypair();
    const newKey = await generateRootKeypair();
    const did = deriveDid(current.publicKey);

    const statement = await createRotationStatement(
      did,
      newKey.publicKey,
      current.privateKey,
    );

    const tampered = { ...statement, did: "did:syr:zTampered" };
    const valid = await verifyRotationStatement(tampered, current.publicKey);
    expect(valid).toBe(false);
  });
});
