import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, SettingsSchema } from "../settings.js";
import { MODEL_CHOICES } from "../models.js";

describe("settings", () => {
  it("defaults to a model that is actually on offer", () => {
    expect(MODEL_CHOICES.map((model) => model.id)).toContain(DEFAULT_SETTINGS.modelId);
  });

  it("defaults match the budget defaults the loop uses", () => {
    // Otherwise the settings screen would quietly disagree with docs/06.
    expect(DEFAULT_SETTINGS.maxSteps).toBe(12);
    expect(DEFAULT_SETTINGS.maxNetworkFetches).toBe(6);
  });

  it("rejects settings that would make a run unbounded", () => {
    expect(() => SettingsSchema.parse({ ...DEFAULT_SETTINGS, maxSteps: 0 })).toThrow();
    expect(() =>
      SettingsSchema.parse({ ...DEFAULT_SETTINGS, maxSteps: 10_000 }),
    ).toThrow();
  });

  it("rejects a history cap of zero, which would discard every audit", () => {
    expect(() =>
      SettingsSchema.parse({ ...DEFAULT_SETTINGS, historyCap: 0 }),
    ).toThrow();
  });

  it("accepts extra allowed domains, which widen what a run can reach", () => {
    const parsed = SettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      extraAllowedDomains: ["policies.example.com"],
    });
    expect(parsed.extraAllowedDomains).toEqual(["policies.example.com"]);
  });
});
