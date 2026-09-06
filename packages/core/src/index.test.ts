import { describe, expect, it } from "vitest";

import { VERSION } from "./index.js";

describe("core scaffold", () => {
  it("exports a version", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
