import { describe, expect, it } from "vitest";

import { stableHash } from "../hash.js";

describe("stableHash", () => {
  it("is deterministic", () => {
    expect(stableHash("webaudit")).toBe(stableHash("webaudit"));
  });

  it("returns 16 hex characters for any input, including empty", () => {
    for (const input of ["", "a", "webaudit", "x".repeat(10_000)]) {
      expect(stableHash(input)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("separates inputs that differ by one character", () => {
    expect(stableHash("hsts-missing")).not.toBe(stableHash("hsts-missinh"));
  });

  it("does not collapse non-ASCII to the same value", () => {
    expect(stableHash("café")).not.toBe(stableHash("cafe"));
    expect(stableHash("日本")).not.toBe(stableHash("本日"));
  });
});
