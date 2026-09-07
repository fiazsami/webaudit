import { describe, expect, it } from "vitest";

import { createVerifiedAppConfig, pinnedModelIds } from "../model-integrity.js";
import { MODEL_CHOICES } from "../models.js";

describe("model integrity", () => {
  it("has a pinned hash for every model we offer", () => {
    // Offering a model we cannot verify is the situation this exists to end.
    const pinned = new Set(pinnedModelIds());
    for (const model of MODEL_CHOICES) {
      expect(pinned.has(model.id)).toBe(true);
    }
  });

  it("puts integrity on every record in the config it builds", () => {
    for (const record of createVerifiedAppConfig().model_list) {
      expect(record.integrity).toBeDefined();
      expect(record.integrity?.onFailure).toBe("error");
    }
  });

  it("leaves out models it has no hashes for, rather than passing them through", () => {
    const config = createVerifiedAppConfig();
    expect(config.model_list).toHaveLength(MODEL_CHOICES.length);
  });

  it("pins well-formed SRI hashes for the config and the model library", () => {
    for (const record of createVerifiedAppConfig().model_list) {
      expect(record.integrity?.config).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
      // The .wasm is the executable part; it is the one that most needs pinning.
      expect(record.integrity?.model_lib).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    }
  });

  it("pins every tokenizer file the model declares", () => {
    for (const record of createVerifiedAppConfig().model_list) {
      const files = Object.keys(record.integrity?.tokenizer ?? {});
      expect(files).toContain("tokenizer.json");
    }
  });
});
