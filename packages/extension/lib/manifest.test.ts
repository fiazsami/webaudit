import { describe, expect, it } from "vitest";

import { VERSION } from "core";

describe("extension scaffold", () => {
  it("imports core from the browser host", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
