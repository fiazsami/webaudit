import { describe, expect, it } from "vitest";

import { VERSION } from "core";

import { USAGE } from "./usage.js";

describe("cli scaffold", () => {
  it("imports core from the Node host", () => {
    expect(VERSION).toBe("0.0.0");
  });

  it("documents the audit command", () => {
    expect(USAGE).toContain("webaudit audit <snapshot.json>");
  });
});
