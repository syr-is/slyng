import { describe, it, expect } from "vitest";
import { canonicalize } from "../index.js";

describe("canonicalize", () => {
  it("sorts keys lexicographically", () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("produces compact JSON with no whitespace", () => {
    const result = canonicalize({ hello: "world", foo: "bar" });
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
  });

  it("is deterministic across calls", () => {
    const obj = {
      did: "did:syr:z6Mk",
      provider: "https://example.com",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const a = canonicalize(obj);
    const b = canonicalize(obj);
    expect(a).toBe(b);
  });

  it("handles nested objects with sorted keys", () => {
    const result = canonicalize({ b: { z: 1, a: 2 }, a: "first" });
    expect(result).toBe('{"a":"first","b":{"a":2,"z":1}}');
  });

  it("handles arrays (preserves order)", () => {
    const result = canonicalize({ arr: [3, 1, 2] } as Record<string, unknown>);
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it("handles empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("handles string values with special characters", () => {
    const result = canonicalize({ key: 'value "with" quotes' });
    expect(result).toContain('\\"with\\"');
  });
});
