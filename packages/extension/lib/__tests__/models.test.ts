import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_ID, findModel, MODEL_CHOICES } from "../models.js";

describe("model choices", () => {
  it("has exactly one recommended model, and it is the default", () => {
    const recommended = MODEL_CHOICES.filter((model) => model.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.id).toBe(DEFAULT_MODEL_ID);
  });

  it("resolves the default", () => {
    expect(findModel(DEFAULT_MODEL_ID)).toBeDefined();
  });

  it("does not recommend the model S2 measured as too slow", () => {
    const llama = findModel("Llama-3.1-8B-Instruct-q4f16_1-MLC");
    expect(llama?.recommended).toBeUndefined();
    expect(llama?.note).toMatch(/six minutes/);
  });

  it("states a download size for every model, so nothing starts as a surprise", () => {
    for (const model of MODEL_CHOICES) {
      expect(model.downloadMB).toBeGreaterThan(0);
    }
  });
});
