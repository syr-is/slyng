import { describe, it, expect } from "vitest";
import {
  createRotationStatement,
  verifyRotationChain,
  genesisKeyFromDid,
  genesisRootMultibase,
  generateRootKeypair,
  encodeMultibase,
  ED25519_MULTICODEC_PREFIX,
  deriveDid,
  type Keypair,
  type RotationStatement,
} from "../index.js";

const rootMultibase = (publicKey: Uint8Array) =>
  encodeMultibase(new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...publicKey]));

/** Build a valid n-hop chain. keys[0] is genesis; keys[i] retires at hop i. */
async function buildChain(
  n: number,
): Promise<{ did: string; statements: RotationStatement[]; keys: Keypair[] }> {
  const keys: Keypair[] = [await generateRootKeypair()];
  const did = deriveDid(keys[0].publicKey);
  for (let i = 0; i < n; i++) keys.push(await generateRootKeypair());

  const statements: RotationStatement[] = [];
  for (let i = 0; i < n; i++) {
    const prevRoot =
      i === 0 ? genesisRootMultibase(did) : statements[i - 1].newRoot;
    statements.push(
      await createRotationStatement(
        did,
        i + 1,
        prevRoot,
        keys[i + 1].publicKey,
        keys[i].privateKey,
      ),
    );
  }
  return { did, statements, keys };
}

describe("rotation chain (v2)", () => {
  it("empty chain resolves to the genesis key", async () => {
    const genesis = await generateRootKeypair();
    const did = deriveDid(genesis.publicKey);
    expect(verifyRotationChain(did, [])).toEqual(genesis.publicKey);
    expect(genesisKeyFromDid(did)).toEqual(genesis.publicKey);
  });

  it("verifies a happy 3-hop chain and returns the current root", async () => {
    const { did, statements, keys } = await buildChain(3);
    expect(statements).toHaveLength(3);
    expect(statements[0].seq).toBe(1);
    expect(statements[0].prevRoot).toBe(rootMultibase(keys[0].publicKey));
    const current = verifyRotationChain(did, statements);
    expect(current).toEqual(keys[3].publicKey);
  });

  it("first statement's prevRoot equals the genesis key", async () => {
    const { did, statements } = await buildChain(1);
    expect(statements[0].prevRoot).toBe(genesisRootMultibase(did));
  });

  it("rejects a seq gap", async () => {
    const { did, statements } = await buildChain(3);
    statements[2].seq = 4;
    expect(() => verifyRotationChain(did, statements)).toThrow();
  });

  it("rejects a wrong signer", async () => {
    const { did, statements, keys } = await buildChain(2);
    // Re-sign hop 2 with the genesis key instead of keys[1].
    statements[1] = await createRotationStatement(
      did,
      2,
      statements[1].prevRoot,
      keys[2].publicKey,
      keys[0].privateKey,
    );
    expect(() => verifyRotationChain(did, statements)).toThrow();
  });

  it("rejects a fork (prevRoot mismatch)", async () => {
    const { did, statements } = await buildChain(3);
    const other = await generateRootKeypair();
    statements[2].prevRoot = rootMultibase(other.publicKey);
    expect(() => verifyRotationChain(did, statements)).toThrow();
  });

  it("rejects a first prevRoot that is not genesis", async () => {
    const genesis = await generateRootKeypair();
    const did = deriveDid(genesis.publicKey);
    const rogue = await generateRootKeypair();
    const next = await generateRootKeypair();
    const stmt = await createRotationStatement(
      did,
      1,
      rootMultibase(rogue.publicKey),
      next.publicKey,
      rogue.privateKey,
    );
    expect(() => verifyRotationChain(did, [stmt])).toThrow();
  });

  it("rejects cross-DID replay", async () => {
    const { statements } = await buildChain(2);
    const other = await generateRootKeypair();
    const otherDid = deriveDid(other.publicKey);
    expect(() => verifyRotationChain(otherDid, statements)).toThrow();
  });
});
